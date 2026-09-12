import { getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";

const tables = ["api_tokens", "sessions", "auth_one_time_tokens", "users", "notes", "tenant"];

export async function rollback() {
  await ensureAppDatabase();
  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
    console.log(`dropped ${table}`);
  }
}

if (import.meta.main) {
  await rollback();
  console.log("Rolled back starter tables.");
  process.exit(0);
}
