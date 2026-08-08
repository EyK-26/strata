import type { Migration } from "./types";

const migration: Migration = {
  name: "0016_extend_audit_logs",
  async up(db) {
    await db`
      ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS previous_payload JSONB,
      ADD COLUMN IF NOT EXISTS ip_address TEXT,
      ADD COLUMN IF NOT EXISTS user_agent TEXT,
      ADD COLUMN IF NOT EXISTS checksum TEXT
    `;
  },
  async down(db) {
    await db`
      ALTER TABLE audit_log
      DROP COLUMN IF EXISTS checksum,
      DROP COLUMN IF EXISTS user_agent,
      DROP COLUMN IF EXISTS ip_address,
      DROP COLUMN IF EXISTS previous_payload
    `;
  },
};

export default migration;
