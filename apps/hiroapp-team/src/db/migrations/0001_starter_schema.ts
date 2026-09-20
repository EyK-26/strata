import type { Migration } from "@getstrata/core/database/migrations/types";

const migration: Migration = {
  name: "0001_starter_schema",
  async up(db) {
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS failed_job (\n    id SERIAL PRIMARY KEY,\n    job_name TEXT NOT NULL,\n    payload JSONB NOT NULL,\n    exception TEXT NOT NULL,\n    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS notes (\n    id SERIAL PRIMARY KEY,\n    body TEXT NOT NULL,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS users (\n    id SERIAL PRIMARY KEY,\n    name TEXT NOT NULL,\n    email TEXT NOT NULL UNIQUE,\n    password TEXT NOT NULL,\n    is_admin BOOLEAN NOT NULL DEFAULT FALSE,\n    session_valid_after TIMESTAMPTZ,\n    email_verified_at TIMESTAMPTZ,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS auth_one_time_tokens (\n    id SERIAL PRIMARY KEY,\n    purpose TEXT NOT NULL,\n    user_id INTEGER NOT NULL,\n    token_hash TEXT NOT NULL UNIQUE,\n    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    consumed_at TIMESTAMPTZ\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS sessions (\n    id TEXT PRIMARY KEY,\n    user_id INTEGER NOT NULL,\n    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    user_agent TEXT,\n    ip_address TEXT,\n    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS auth_saml_assertions (\n    assertion_id TEXT PRIMARY KEY,\n    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
  },
  async down(db) {
    await db.unsafe("DROP TABLE IF EXISTS failed_job CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS sessions CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS auth_saml_assertions CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS auth_one_time_tokens CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS users CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS notes CASCADE");
  },
};

export default migration;
