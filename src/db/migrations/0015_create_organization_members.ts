import type { Migration } from "./types";

const migration: Migration = {
  name: "0015_create_organization_members",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS organization_member (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member'
          CHECK (role IN ('owner', 'admin', 'member')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, user_id)
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_organization_member_org
      ON organization_member(organization_id)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS organization_member CASCADE`;
  },
};

export default migration;
