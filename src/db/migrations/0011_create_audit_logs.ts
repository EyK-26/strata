import type { Migration } from "./types";

const migration: Migration = {
  name: "0011_create_audit_logs",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id INTEGER,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS audit_log CASCADE`;
  },
};

export default migration;
