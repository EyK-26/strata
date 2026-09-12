import { closeDatabase, getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { migrate } from "./migrate.ts";

const tables = ["api_tokens", "sessions", "auth_one_time_tokens", "users", "notes", "tenant"];

export async function fresh() {
  await ensureAppDatabase();
  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  await migrate();
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
