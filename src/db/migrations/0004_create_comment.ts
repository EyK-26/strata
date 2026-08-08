import type { Migration } from "./types";

const migration: Migration = {
  name: "0004_create_comment",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS comment (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_comment_task_id ON comment(task_id)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS comment CASCADE`;
  },
};

export default migration;
