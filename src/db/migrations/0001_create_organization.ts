import type { Migration } from "./types";

const migration: Migration = {
  name: "0001_create_organization",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS organization (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_organization_slug ON organization(slug)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS organization CASCADE`;
  },
};

export default migration;
