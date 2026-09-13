import { hashPassword } from "@getstrata/core/auth/password";
import {
  grantPostgresAppRolePrivileges,
  openPostgresAdminConnection,
  postgresDatabaseNameFromUrl,
} from "@getstrata/core/tenant/enableTenantRls";
import { closeDatabase } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { Note } from "../models/Note.ts";
import { User } from "../models/User.ts";

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
  `CREATE TABLE IF NOT EXISTS auth_saml_assertions (
    assertion_id TEXT PRIMARY KEY,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

export async function seed() {
  await ensureAppDatabase();

  if ((await Note.query().value("id")) === null) {
    await Note.create({ body: "Welcome to Strata!" });
  }
  if ((await User.query().value("id")) === null) {
    const password = await hashPassword("StrataDemo!ChangeMe");
    await User.create({
      name: "Demo User",
      email: "demo@example.com",
      password,
      is_admin: false,
    });
    await User.create({
      name: "Admin User",
      email: "admin@example.test",
      password,
      is_admin: true,
    });
  }
}

export async function migrate() {
  await ensureAppDatabase();
  const runtimeUrl = process.env.DATABASE_URL ?? "";
  const admin = await openPostgresAdminConnection({
    runtimeUrl,
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    for (const statement of migrations) {
      await admin.unsafe(statement);
    }
    await grantPostgresAppRolePrivileges(admin, {
      database: postgresDatabaseNameFromUrl(runtimeUrl),
    });
  } finally {
    await admin.close?.();
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
