import { getMigrationStatus } from "@getstrata/core/database/migrations/runner";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function status() {
  await ensureAppDatabase();
  const rows = await withMigrationDatabase(async (db) => {
    return getMigrationStatus(db, await loadStarterMigrations());
  });
  console.log("Migrations:");
  for (const row of rows) {
    const batch = row.batch == null ? "" : ` (batch ${row.batch})`;
    console.log(`- [${row.status}] ${row.name}${batch}`);
  }
}

if (import.meta.main) {
  await status();
  process.exit(0);
}
