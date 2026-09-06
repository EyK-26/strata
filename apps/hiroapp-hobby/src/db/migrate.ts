import { closeDatabase, getSql } from "../bootstrap/database.ts";

const migrations = [
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

export async function seed() {
  const sql = getSql();
  const [{ count }] = await sql.unsafe<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM notes",
  );
  if (Number(count) === 0) {
    await sql.unsafe("INSERT INTO notes (body) VALUES (?)", ["Welcome to Strata!"]);
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
