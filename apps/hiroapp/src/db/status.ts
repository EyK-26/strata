import { getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";

const tables = ["api_tokens", "sessions", "auth_one_time_tokens", "users", "notes", "tenant"];

export async function status() {
  await ensureAppDatabase();
  const sql = getSql();
  console.log("Starter schema (inline SQL, not a migration runner):");
  for (const table of tables) {
    try {
      const rows = await sql.unsafe<{ count: string | number }>(
        `SELECT COUNT(*) AS count FROM ${table}`,
      );
      console.log(`- [present] ${table} (rows: ${rows[0]?.count ?? 0})`);
    } catch {
      console.log(`- [missing] ${table}`);
    }
  }
}

if (import.meta.main) {
  await status();
  process.exit(0);
}
