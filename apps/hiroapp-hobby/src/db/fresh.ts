import { getSql } from "../bootstrap/database.ts";
import { migrate } from "./migrate.ts";

const tables = ["notes"];

export async function fresh() {
  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
  }
  await migrate();
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset, migrated, and seeded.");
  process.exit(0);
}
