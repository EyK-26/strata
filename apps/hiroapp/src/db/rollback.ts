import { rollbackDatabase } from "@getstrata/core/database/migrations/runner";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function rollback() {
  await ensureAppDatabase();
  const rolledBack = await withMigrationDatabase(async (db) => {
    return rollbackDatabase(db, await loadStarterMigrations(), {
      onMigration: (name) => {
        console.log(`rolled back ${name}`);
      },
    });
  });
  if (rolledBack === 0) {
    console.log("Nothing to roll back.");
  }
}

if (import.meta.main) {
  await rollback();
  console.log("Rolled back last migration batch.");
  process.exit(0);
}
