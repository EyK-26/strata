import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { withMigrationLock } from "./advisoryLock.ts";
import type { Migration, MigrationDatabase, MigrationStatus } from "./types.ts";

type AppliedMigrationRow = {
  name: string;
  batch: number | string;
};

const MIGRATIONS_TABLE = "framework_migrations";

async function ensureMigrationsTable(db: MigrationDatabase): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name TEXT PRIMARY KEY,
      batch INTEGER NOT NULL,
      run_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(db: MigrationDatabase): Promise<AppliedMigrationRow[]> {
  await ensureMigrationsTable(db);
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
        entry !== "types.ts" &&
        entry !== "index.ts" &&
        entry !== "runner.ts",
    )
    .sort();

  const loadedMigrations = await Promise.all(
    migrationFiles.map(async (fileName) => {
      const moduleUrl = pathToFileURL(join(directory, fileName)).href;
      const module = (await import(moduleUrl)) as { default: Migration };
      return module.default;
    }),
  );

  return loadedMigrations.filter(
    (migration): migration is Migration => migration?.name !== undefined,
  );
}

async function getMigrationStatus(
  db: MigrationDatabase,
  migrations: Migration[],
): Promise<MigrationStatus[]> {
  const applied = await getAppliedMigrations(db);
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
  const applied = await getAppliedMigrations(db);
  const appliedNames = new Set(applied.map(({ name }) => name));
  const nextBatch =
    applied.reduce((currentMax, { batch }) => Math.max(currentMax, Number(batch)), 0) + 1;

  const pendingMigrations = migrations.filter(({ name }) => !appliedNames.has(name));

  for (const migration of pendingMigrations) {
    options.onMigration?.(migration.name);
    await migration.up(db);
    const inserted = (await db.unsafe(
      `INSERT INTO ${MIGRATIONS_TABLE} (name, batch) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING name`,
      [migration.name, nextBatch],
    )) as { name: string }[];

    if (inserted.length === 0) {
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
  const applied = await getAppliedMigrations(db);

  if (applied.length === 0) {
    return 0;
  }

  const lastBatch = applied.reduce(
    (currentMax, { batch }) => Math.max(currentMax, Number(batch)),
    0,
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
    await db.unsafe(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`, [migration.name]);
    rolledBack += 1;
  }

  return rolledBack;
}

async function freshDatabase(
  db: MigrationDatabase,
  migrations: Migration[],
  options: { advisoryLock?: boolean; onMigration?: (name: string) => void } = {},
): Promise<void> {
  const runFresh = async (): Promise<void> => {
    const applied = await getAppliedMigrations(db);
    const appliedNames = new Set(applied.map(({ name }) => name));
    const appliedMigrations = migrations.filter(({ name }) => appliedNames.has(name));

    for (const migration of [...appliedMigrations].reverse()) {
      options.onMigration?.(migration.name);
      await migration.down(db);
    }

    if (appliedMigrations.length > 0) {
      await db.unsafe(`DELETE FROM ${MIGRATIONS_TABLE}`);
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
