import { freshDatabase } from "@getstrata/core/database/migrations";
import { closeDatabase } from "../bootstrap/database.ts";
import { seed } from "./migrate.ts";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function fresh() {
  await withMigrationDatabase(async (db) => {
    await freshDatabase(db, await loadStarterMigrations());
  });
  await seed();
}

/** The CLI calls this after fresh() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset, migrated, and seeded.");
  await close();
  process.exit(0);
}
