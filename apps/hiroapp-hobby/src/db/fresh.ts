import { closeDatabase, getSql } from "../bootstrap/database.ts";
import { migrate } from "./migrate.ts";

const tables = ["notes"];

export async function fresh() {
  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
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
