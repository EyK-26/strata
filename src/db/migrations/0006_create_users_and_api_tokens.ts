import type { Migration } from "./types";

const migration: Migration = {
  name: "0006_create_users_and_api_tokens",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS api_token (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_api_token_hash ON api_token(token_hash)
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_api_token_user_id ON api_token(user_id)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS api_token CASCADE`;
    await db`DROP TABLE IF EXISTS users CASCADE`;
  },
};

export default migration;
