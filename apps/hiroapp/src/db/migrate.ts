import { hashPassword } from "@getstrata/core/auth/password";
import { getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";

const migrations = [
  `CREATE TABLE IF NOT EXISTS tenant (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL DEFAULT 'enterprise',
    region TEXT NOT NULL DEFAULT 'eu'
  )`,
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
    tenant_id INTEGER NOT NULL DEFAULT 1,
    mfa_secret TEXT,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_recovery_codes TEXT,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip_address TEXT,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    abilities TEXT NOT NULL DEFAULT '[]',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

export async function seed() {
  await ensureAppDatabase();
  const sql = getSql();
  const [{ count }] = await sql.unsafe<Array<{ count: string | number }>>(
    "SELECT COUNT(*) AS count FROM notes",
  );
  if (Number(count) === 0) {
    await sql.unsafe("INSERT INTO notes (body) VALUES ($1)", ["Welcome to Strata!"]);
  }
  const [{ count: tenantCount }] = await sql.unsafe<Array<{ count: string | number }>>(
    "SELECT COUNT(*) AS count FROM tenant",
  );
  if (Number(tenantCount) === 0) {
    await sql.unsafe("INSERT INTO tenant (slug, plan, region) VALUES ($1, $2, $3)", [
      "default",
      "enterprise",
      "eu",
    ]);
  }
  const [{ count: userCount }] = await sql.unsafe<Array<{ count: string | number }>>(
    "SELECT COUNT(*) AS count FROM users",
  );
  if (Number(userCount) === 0) {
    const password = await hashPassword("password");
    await sql.unsafe(
      "INSERT INTO users (name, email, password, is_admin, email_verified_at) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)",
      [
        "Demo User",
        "demo@example.com",
        password,
        false,
        new Date().toISOString(),
        "Admin User",
        "admin@example.test",
        password,
        true,
        new Date().toISOString(),
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

if (import.meta.main) {
  await migrate();
  console.log("Database migrated and seeded.");
  process.exit(0);
}
