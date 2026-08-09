import { getSql } from "../bootstrap/database.ts";

const migrations = [
  `CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

export async function migrate() {
  const sql = getSql();
  for (const statement of migrations) {
    await sql.unsafe(statement);
  }
}

export async function seed() {
  const sql = getSql();
  const [{ count }] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM notes
  `;
  if (Number(count) > 0) return;

  await sql`
    INSERT INTO notes (body) VALUES ('Welcome to Strata!')
  `;
}

if (import.meta.main) {
  await migrate();
  await seed();
  console.log("Database migrated and seeded.");
  process.exit(0);
}
