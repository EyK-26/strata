import { getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { migrate } from "./migrate.ts";

const tables = ["sessions", "users", "notes"];

export async function fresh() {
  await ensureAppDatabase();
  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  await migrate();
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset, migrated, and seeded.");
  process.exit(0);
}
