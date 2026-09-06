import { getSql } from "../bootstrap/database.ts";

const tables = ["notes"];

export async function status() {
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
