import {
  ensureMigrationsTable as ensureCoreMigrationsTable,
  freshDatabase as freshCoreDatabase,
  getMigrationStatus as getCoreMigrationStatus,
  loadMigrationsFromDirectory,
  migrateDatabase as migrateCoreDatabase,
  rollbackDatabase as rollbackCoreDatabase,
} from "../../core/database/migrations/runner";
import type { MigrationStatus } from "../../core/database/migrations/types";
import { type FixtureSchemaOptions, withFixtureSchema } from "../fixtureSchemaOwner";
import { seedSelectedDatabase } from "../seeders/runner";

async function ensureMigrationsTable(options: FixtureSchemaOptions = {}): Promise<void> {
  await withFixtureSchema(ensureCoreMigrationsTable, options);
}
async function getMigrationStatus(options: FixtureSchemaOptions = {}): Promise<MigrationStatus[]> {
  return withFixtureSchema(
    async (db) => getCoreMigrationStatus(db, await loadMigrationsFromDirectory(import.meta.dir)),
    options,
  );
}
async function migrateDatabase(options: FixtureSchemaOptions = {}): Promise<void> {
  const count = await withFixtureSchema(
    async (db) =>
      migrateCoreDatabase(db, await loadMigrationsFromDirectory(import.meta.dir), {
        onMigration: (name) => console.log(`Migrating ${name}...`),
      }),
    options,
  );
  console.log(count ? `Applied ${count} migration(s).` : "No pending migrations.");
}
async function rollbackDatabase(options: FixtureSchemaOptions = {}): Promise<void> {
  const count = await withFixtureSchema(
    async (db) =>
      rollbackCoreDatabase(db, await loadMigrationsFromDirectory(import.meta.dir), {
        onMigration: (name) => console.log(`Rolling back ${name}...`),
      }),
    options,
  );
  console.log(count ? `Rolled back ${count} migration(s).` : "No migrations have been applied.");
}
async function freshDatabase(
  options: FixtureSchemaOptions & { seed?: boolean } = {},
): Promise<void> {
  await withFixtureSchema(async (db) => {
    await freshCoreDatabase(db, await loadMigrationsFromDirectory(import.meta.dir), {
      destructive: true,
      onMigration: (name) => console.log(`Refreshing ${name}...`),
    });
    if (options.seed) await seedSelectedDatabase(db);
  }, options);
  console.log("Database reset complete.");
}

export type { MigrationStatus };
export {
  ensureMigrationsTable,
  freshDatabase,
  getMigrationStatus,
  migrateDatabase,
  rollbackDatabase,
};
