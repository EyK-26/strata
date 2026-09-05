import { getSql } from "../bootstrap/database.ts";

const tables = ["notes"];

export async function rollback() {
  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
    console.log(`dropped ${table}`);
  }
}

if (import.meta.main) {
  await rollback();
  console.log("Rolled back starter tables.");
  process.exit(0);
}
