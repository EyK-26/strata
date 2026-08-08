import type { Migration } from "./types";

const migration: Migration = {
  name: "0008_create_failed_jobs",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS failed_job (
        id SERIAL PRIMARY KEY,
        job_name TEXT NOT NULL,
        payload JSONB NOT NULL,
        exception TEXT NOT NULL,
        failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_failed_job_name ON failed_job(job_name)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS failed_job CASCADE`;
  },
};

export default migration;
