import { hashPassword } from "@getstrata/core/auth/password";
import { closeDatabase, getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { Note } from "../models/Note.ts";

const migrations = [
  `CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    session_valid_after TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS auth_one_time_tokens (
    id SERIAL PRIMARY KEY,
    purpose TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip_address TEXT,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
];

export async function seed() {
  await ensureAppDatabase();
  const sql = getSql();

  if ((await Note.query().value("id")) === null) {
    await Note.create({ body: "Welcome to Strata!" });
  }
  const [{ count: userCount }] = await sql.unsafe<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM users",
  );
  if (Number(userCount) === 0) {
    const password = await hashPassword("StrataDemo!ChangeMe");
    await sql.unsafe(
      "INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)",
      [
        "Demo User",
        "demo@example.com",
        password,
        false,
        "Admin User",
        "admin@example.test",
        password,
        true,
      ],
    );
  }
}

export async function migrate() {
  await ensureAppDatabase();
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
