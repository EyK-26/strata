import type { Migration } from "@getstrata/core/database/migrations/types";

const migration: Migration = {
  name: "0001_starter_schema",
  async up(db) {
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS failed_job (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    job_name TEXT NOT NULL,\n    payload TEXT NOT NULL,\n    exception TEXT NOT NULL,\n    failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS notes (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    body TEXT NOT NULL,\n    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n  )",
    );
  },
  async down(db) {
    await db.unsafe("DROP TABLE IF EXISTS failed_job");
    await db.unsafe("DROP TABLE IF EXISTS notes");
  },
};

export default migration;
