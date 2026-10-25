import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isProductionEnv } from "../../runtime/appEnv.ts";
import { currentSqlDialect } from "../dialect.ts";
import { withMigrationLock } from "./advisoryLock.ts";
import type { Migration, MigrationDatabase, MigrationStatus } from "./types.ts";

type AppliedMigrationRow = {
  name: string;
  batch: number | string;
};

const MIGRATIONS_TABLE = "framework_migrations";

/** Validate the complete set before callbacks, locks or database effects. */
function validateMigrations(
  migrations: unknown,
  sources?: readonly string[],
): asserts migrations is Migration[] {
  if (!Array.isArray(migrations)) throw new Error("Migrations must be an array of definitions.");
  const names = new Map<string, string>();
  for (const [index, migration] of migrations.entries()) {
    const source = sources?.[index] ?? `migration at index ${index}`;
    if (
      !migration ||
      typeof migration !== "object" ||
      Array.isArray(migration) ||
      typeof migration.name !== "string" ||
      migration.name.trim().length === 0 ||
      typeof migration.up !== "function" ||
      typeof migration.down !== "function"
    ) {
      throw new Error(
        `Invalid ${source}: expected a migration with a non-empty string name and up/down functions.`,
      );
    }
    const previous = names.get(migration.name);
    if (previous !== undefined)
      throw new Error(`Duplicate migration name "${migration.name}" in ${previous} and ${source}.`);
    names.set(migration.name, source);
  }
}

function requireMigrationDefinitions(
  applied: AppliedMigrationRow[],
  migrations: Migration[],
  operation: string,
): void {
  const names = new Set(migrations.map(({ name }) => name));
  const missing = applied.filter(({ name }) => !names.has(name)).map(({ name }) => name);
  if (missing.length > 0) {
    throw new Error(
      `Cannot ${operation}: missing applied migration definitions: ${missing.join(", ")}. Restore the migration files before retrying; history has not been removed.`,
    );
  }
}

function migrationsNameColumn(): string {
  return currentSqlDialect().driver === "mysql" ? "VARCHAR(255) PRIMARY KEY" : "TEXT PRIMARY KEY";
}

function migrationsRunOnColumn(): string {
  const dialect = currentSqlDialect();
  if (dialect.driver === "pgsql") {
    return `TIMESTAMPTZ NOT NULL DEFAULT ${dialect.nowExpression()}`;
  }
  if (dialect.driver === "mysql") {
    return `DATETIME NOT NULL DEFAULT ${dialect.nowExpression()}`;
  }
  return "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP";
}

async function ensureMigrationsTable(db: MigrationDatabase): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name ${migrationsNameColumn()},
      batch INTEGER NOT NULL,
      run_on ${migrationsRunOnColumn()}
    )
  `);
}

async function recordAppliedMigration(
  db: MigrationDatabase,
  name: string,
  batch: number,
): Promise<boolean> {
  const dialect = currentSqlDialect();
  const inserted = (await db.unsafe(
    `INSERT INTO ${MIGRATIONS_TABLE} (name, batch) VALUES (${dialect.placeholder(1)}, ${dialect.placeholder(2)})${dialect.upsertSuffix(["name"], [])}${dialect.returningClause("name")}`,
    [name, batch],
  )) as { name: string }[];

  if (dialect.returningClause("name")) {
    return inserted.length > 0;
  }

  const rows = (await db.unsafe(
    `SELECT batch FROM ${MIGRATIONS_TABLE} WHERE name = ${dialect.placeholder(1)}`,
    [name],
  )) as { batch: number | string }[];

  return rows.some((row) => Number(row.batch) === batch);
}

async function getAppliedMigrations(db: MigrationDatabase): Promise<AppliedMigrationRow[]> {
  await ensureMigrationsTable(db);
  return readAppliedMigrations(db);
}

/** Inspection requires existing history; only explicit migration operations initialize it. */
async function readAppliedMigrations(db: MigrationDatabase): Promise<AppliedMigrationRow[]> {
  return (await db.unsafe(`
    SELECT name, batch
    FROM ${MIGRATIONS_TABLE}
    ORDER BY batch ASC, name ASC
  `)) as AppliedMigrationRow[];
}

async function loadMigrationsFromDirectory(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory);
  const migrationFiles = entries
    .filter(
      (entry) =>
        (entry.endsWith(".ts") || entry.endsWith(".js")) &&
        !entry.endsWith(".d.ts") &&
        !["types", "index", "runner", "advisoryLock", "migrationDatabase"].some(
          (name) => entry === `${name}.ts` || entry === `${name}.js`,
        ),
    )
    .sort();

  const loadedMigrations = await Promise.all(
    migrationFiles.map(async (fileName) => {
      const moduleUrl = pathToFileURL(join(directory, fileName)).href;
      const module = (await import(moduleUrl)) as { default?: unknown };
      return module.default;
    }),
  );

  validateMigrations(
    loadedMigrations,
    migrationFiles.map((file) => join(directory, file)),
  );
  return loadedMigrations;
}

async function getMigrationStatus(
  db: MigrationDatabase,
  migrations: Migration[],
): Promise<MigrationStatus[]> {
  validateMigrations(migrations);
  const applied = await readAppliedMigrations(db);
  const appliedByName = new Map(applied.map(({ name, batch }) => [name, Number(batch)]));

  return migrations.map(({ name }) => ({
    name,
    status: appliedByName.has(name) ? "up" : "pending",
    batch: appliedByName.get(name) ?? null,
  }));
}

async function runPendingMigrations(
  db: MigrationDatabase,
  migrations: Migration[],
  options: { onMigration?: (name: string) => void } = {},
): Promise<number> {
  validateMigrations(migrations);
  const applied = await getAppliedMigrations(db);
  const appliedNames = new Set(applied.map(({ name }) => name));
  const nextBatch =
    applied.reduce((currentMax, { batch }) => Math.max(currentMax, Number(batch)), 0) + 1;

  const pendingMigrations = migrations.filter(({ name }) => !appliedNames.has(name));

  for (const migration of pendingMigrations) {
    options.onMigration?.(migration.name);
    await migration.up(db);
    const recorded = await recordAppliedMigration(db, migration.name, nextBatch);

    if (!recorded) {
      throw new Error(`Migration ${migration.name} was applied but not recorded.`);
    }
  }

  return pendingMigrations.length;
}

async function migrateDatabase(
  db: MigrationDatabase,
  migrations: Migration[],
  options: { advisoryLock?: boolean; onMigration?: (name: string) => void } = {},
): Promise<number> {
  validateMigrations(migrations);
  const { advisoryLock = false, onMigration } = options;

  if (advisoryLock) {
    return withMigrationLock(db, () => runPendingMigrations(db, migrations, { onMigration }));
  }

  return runPendingMigrations(db, migrations, { onMigration });
}

async function rollbackDatabase(
  db: MigrationDatabase,
  migrations: Migration[],
  options: { onMigration?: (name: string) => void } = {},
): Promise<number> {
  validateMigrations(migrations);
  const applied = await getAppliedMigrations(db);

  if (applied.length === 0) {
    return 0;
  }

  const lastBatch = applied.reduce(
    (currentMax, { batch }) => Math.max(currentMax, Number(batch)),
    0,
  );
  requireMigrationDefinitions(
    applied.filter(({ batch }) => Number(batch) === lastBatch),
    migrations,
    "roll back latest batch",
  );
  const migrationsToRollback = new Set(
    applied.filter(({ batch }) => Number(batch) === lastBatch).map(({ name }) => name),
  );

  let rolledBack = 0;

  for (const migration of [...migrations].reverse()) {
    if (!migrationsToRollback.has(migration.name)) {
      continue;
    }

    options.onMigration?.(migration.name);
    await migration.down(db);
    await db.unsafe(
      `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ${currentSqlDialect().placeholder(1)}`,
      [migration.name],
    );
    rolledBack += 1;
  }

  return rolledBack;
}

async function freshDatabase(
  db: MigrationDatabase,
  migrations: Migration[],
  options: {
    advisoryLock?: boolean;
    onMigration?: (name: string) => void;
    destructive?: boolean;
  } = {},
): Promise<void> {
  if (options.destructive && isProductionEnv()) {
    throw new Error(
      "Destructive migration reset is only available in development/test environments.",
    );
  }
  validateMigrations(migrations);
  const runFresh = async (): Promise<void> => {
    const applied = await getAppliedMigrations(db);
    requireMigrationDefinitions(applied, migrations, "reset database");
    const appliedNames = new Set(applied.map(({ name }) => name));
    const appliedMigrations = migrations.filter(({ name }) => appliedNames.has(name));

    for (const migration of [...appliedMigrations].reverse()) {
      options.onMigration?.(migration.name);
      if (options.destructive) await migration.down(db, { operation: "fresh" });
      else await migration.down(db);
      // Record each completed down before continuing: a later refusal must not
      // leave already-dropped schema falsely recorded as applied.
      await db.unsafe(
        `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ${currentSqlDialect().placeholder(1)}`,
        [migration.name],
      );
    }

    await runPendingMigrations(db, migrations, options);
  };

  if (options.advisoryLock) {
    await withMigrationLock(db, runFresh);
    return;
  }

  await runFresh();
}

export { withMigrationLock } from "./advisoryLock.ts";
export { guardMigrationRollback, type MigrationRollbackGuard } from "./rollbackGuard.ts";
export {
  ensureMigrationsTable,
  freshDatabase,
  getAppliedMigrations,
  getMigrationStatus,
  loadMigrationsFromDirectory,
  migrateDatabase,
  rollbackDatabase,
  runPendingMigrations,
};
