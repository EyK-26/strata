import { getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { migrate, seed } from "./migrate.ts";

const tables = ["api_tokens", "sessions", "users", "notes", "tenant"];

export async function fresh() {
  await ensureAppDatabase();
  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  await migrate();
  await seed();
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset, migrated, and seeded.");
  process.exit(0);
}
