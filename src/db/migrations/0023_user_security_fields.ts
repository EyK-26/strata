import type { Migration } from "./types";

const migration: Migration = {
  name: "0023_user_security_fields",
  async up(db) {
    await db`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS mfa_secret TEXT,
      ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `;
    await db`
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, created_at)
      WHERE email_verified_at IS NULL
    `;
  },
  async down(db) {
    await db`
      ALTER TABLE users
      DROP COLUMN IF EXISTS email_verified_at,
      DROP COLUMN IF EXISTS mfa_secret,
      DROP COLUMN IF EXISTS mfa_enabled
    `;
  },
};

export default migration;
