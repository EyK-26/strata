import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import db from "../connection";
import { seedDatabase } from "../seeders/runner";
import { withMigrationLock } from "./advisoryLock";
import type { Migration } from "./types";

type AppliedMigrationRow = {
  name: string;
  batch: number | string;
};

type MigrationStatus = {
  name: string;
  status: "up" | "pending";
  batch: number | null;
};

async function ensureMigrationsTable(): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS framework_migrations (
      name TEXT PRIMARY KEY,
      batch INTEGER NOT NULL,
      run_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function getAppliedMigrations(): Promise<AppliedMigrationRow[]> {
  await ensureMigrationsTable();
  return (await db`
    SELECT name, batch
    FROM framework_migrations
    ORDER BY batch ASC, name ASC
  `) as AppliedMigrationRow[];
}

async function loadMigrations(): Promise<Migration[]> {
  const entries = await readdir(import.meta.dir);
  const migrationFiles = entries
    .filter(
      (entry) =>
        entry.endsWith(".ts") &&
        entry !== "types.ts" &&
        entry !== "index.ts" &&
        entry !== "index.ts" &&
        entry !== "runner.ts" &&
        entry !== "advisoryLock.ts",
    )
    .sort();

  const loadedMigrations = await Promise.all(
    migrationFiles.map(async (fileName) => {
      const moduleUrl = pathToFileURL(join(import.meta.dir, fileName)).href;
      const module = (await import(moduleUrl)) as { default: Migration };
      return module.default;
    }),
  );

  return loadedMigrations.filter(
    (migration): migration is Migration => migration?.name !== undefined,
  );
}

async function getMigrationStatus(): Promise<MigrationStatus[]> {
  const [migrations, applied] = await Promise.all([
    loadMigrations(),
    getAppliedMigrations(),
  ]);
  const appliedByName = new Map(
    applied.map(({ name, batch }) => [name, Number(batch)]),
  );

  return migrations.map(({ name }) => ({
    name,
    status: appliedByName.has(name) ? "up" : "pending",
    batch: appliedByName.get(name) ?? null,
  }));
}

async function migrateDatabase(): Promise<void> {
  await withMigrationLock(async () => {
    const migrations = await loadMigrations();
    const applied = await getAppliedMigrations();
    const appliedNames = new Set(applied.map(({ name }) => name));
    const nextBatch =
      applied.reduce(
        (currentMax, { batch }) => Math.max(currentMax, Number(batch)),
        0,
      ) + 1;

    const pendingMigrations = migrations.filter(
      ({ name }) => !appliedNames.has(name),
    );

    if (pendingMigrations.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    for (const migration of pendingMigrations) {
      console.log(`Migrating ${migration.name}...`);
      await migration.up(db);
      await db`
        INSERT INTO framework_migrations (name, batch)
        VALUES (${migration.name}, ${nextBatch})
        ON CONFLICT (name) DO NOTHING
      `;
    }

    console.log(`Applied ${pendingMigrations.length} migration(s).`);
  });
}

async function rollbackDatabase(): Promise<void> {
  const migrations = await loadMigrations();
  const applied = await getAppliedMigrations();

  if (applied.length === 0) {
    console.log("No migrations have been applied.");
    return;
  }

  const lastBatch = applied.reduce(
    (currentMax, { batch }) => Math.max(currentMax, Number(batch)),
    0,
  );
  const migrationsToRollback = applied
    .filter(({ batch }) => Number(batch) === lastBatch)
    .map(({ name }) => name);

  if (migrationsToRollback.length === 0) {
    console.log("No migrations found for rollback.");
    return;
  }

  for (const migration of [...migrations].reverse()) {
    if (!migrationsToRollback.includes(migration.name)) {
      continue;
    }

    console.log(`Rolling back ${migration.name}...`);
    await migration.down(db);
    await db`DELETE FROM framework_migrations WHERE name = ${migration.name}`;
  }

  console.log(`Rolled back ${migrationsToRollback.length} migration(s).`);
}

async function freshDatabase(options: { seed?: boolean } = {}): Promise<void> {
  const { seed = false } = options;
  const migrations = await loadMigrations();
  const applied = await getAppliedMigrations();
  const appliedNames = new Set(applied.map(({ name }) => name));
  const appliedMigrations = migrations.filter(({ name }) =>
    appliedNames.has(name),
  );

  if (appliedMigrations.length === 0) {
    console.log(
      "No applied migrations found. Running a clean migrate instead.",
    );
  } else {
    console.log(
      `Refreshing database by rolling back ${appliedMigrations.length} migration(s)...`,
    );

    for (const migration of [...appliedMigrations].reverse()) {
      console.log(`Dropping ${migration.name}...`);
      await migration.down(db);
    }

    await db`DELETE FROM framework_migrations`;
    console.log("Database reset complete.");
  }

  await migrateDatabase();

  if (seed) {
    await seedDatabase();
  }
}

export {
  ensureMigrationsTable,
  freshDatabase,
  getMigrationStatus,
  migrateDatabase,
  rollbackDatabase,
};
export type { MigrationStatus };
