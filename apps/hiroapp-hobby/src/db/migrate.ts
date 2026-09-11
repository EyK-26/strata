import { closeDatabase, getSql } from "../bootstrap/database.ts";
import { Note } from "../models/Note.ts";

const migrations = [
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

export async function seed() {
  getSql();
  if ((await Note.query().value("id")) === null) {
    await Note.create({ body: "Welcome to Strata!" });
  }
}

export async function migrate() {
  const sql = getSql();
  for (const statement of migrations) {
    await sql.unsafe(statement);
  }
  await seed();
}

/** The CLI calls this after migrate() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await migrate();
  console.log("Database migrated and seeded.");
  await close();
  process.exit(0);
}
