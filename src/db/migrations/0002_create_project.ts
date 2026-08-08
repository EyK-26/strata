import type { Migration } from "./types";

const migration: Migration = {
  name: "0002_create_project",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS project (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'active', 'archived')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, name)
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_project_organization_id ON project(organization_id)
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_project_status ON project(status)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS project CASCADE`;
  },
};

export default migration;
