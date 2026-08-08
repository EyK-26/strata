import type { Migration } from "./types";

const migration: Migration = {
  name: "0005_add_soft_deletes",
  async up(db) {
    await db`
      ALTER TABLE organization
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_organization_deleted_at
      ON organization (deleted_at)
    `;
    await db`
      ALTER TABLE project
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_project_deleted_at
      ON project (deleted_at)
    `;
    await db`
      ALTER TABLE task
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_task_deleted_at
      ON task (deleted_at)
    `;
    await db`
      ALTER TABLE comment
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_comment_deleted_at
      ON comment (deleted_at)
    `;
  },
  async down(db) {
    await db`DROP INDEX IF EXISTS idx_comment_deleted_at`;
    await db`ALTER TABLE comment DROP COLUMN IF EXISTS deleted_at`;
    await db`DROP INDEX IF EXISTS idx_task_deleted_at`;
    await db`ALTER TABLE task DROP COLUMN IF EXISTS deleted_at`;
    await db`DROP INDEX IF EXISTS idx_project_deleted_at`;
    await db`ALTER TABLE project DROP COLUMN IF EXISTS deleted_at`;
    await db`DROP INDEX IF EXISTS idx_organization_deleted_at`;
    await db`ALTER TABLE organization DROP COLUMN IF EXISTS deleted_at`;
  },
};

export default migration;
