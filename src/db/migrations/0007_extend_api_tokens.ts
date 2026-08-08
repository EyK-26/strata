import type { Migration } from "./types";

const migration: Migration = {
  name: "0007_extend_api_tokens",
  async up(db) {
    await db`
      ALTER TABLE api_token
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS abilities JSONB NOT NULL DEFAULT '["*"]'::jsonb
    `;
  },
  async down(db) {
    await db`
      ALTER TABLE api_token
      DROP COLUMN IF EXISTS expires_at,
      DROP COLUMN IF EXISTS abilities
    `;
  },
};

export default migration;
