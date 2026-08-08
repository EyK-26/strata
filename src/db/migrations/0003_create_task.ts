import type { Migration } from "./types";

const migration: Migration = {
  name: "0003_create_task",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS task (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo'
          CHECK (status IN ('todo', 'in_progress', 'done')),
        priority INTEGER NOT NULL DEFAULT 0
          CHECK (priority >= 0 AND priority <= 5),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_task_project_id ON task(project_id)
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_task_status ON task(status)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS task CASCADE`;
  },
};

export default migration;
