import type { Migration } from "./types";

const migration: Migration = {
  name: "0010_create_oauth_identities",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS oauth_identity (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider, provider_user_id)
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_oauth_identity_user_id ON oauth_identity(user_id)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS oauth_identity CASCADE`;
  },
};

export default migration;
