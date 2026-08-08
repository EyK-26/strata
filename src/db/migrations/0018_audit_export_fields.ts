import type { Migration } from "./types";

const migration: Migration = {
  name: "0018_audit_export_fields",
  async up(db) {
    await db`
      ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
      ADD COLUMN IF NOT EXISTS trace_id TEXT,
      ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_audit_log_exported_at
      ON audit_log(exported_at)
      WHERE exported_at IS NULL
    `;
  },
  async down(db) {
    await db`
      ALTER TABLE audit_log
      DROP COLUMN IF EXISTS exported_at,
      DROP COLUMN IF EXISTS trace_id,
      DROP COLUMN IF EXISTS tenant_id
    `;
  },
};

export default migration;
