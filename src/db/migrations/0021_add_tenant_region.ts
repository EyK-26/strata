import type { Migration } from "./types";

const migration: Migration = {
  name: "0021_add_tenant_region",
  async up(db) {
    await db`
      ALTER TABLE tenant
      ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'eu'
        CHECK (region IN ('eu', 'us', 'apac'))
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_tenant_region ON tenant(region)
    `;
  },
  async down(db) {
    await db`DROP INDEX IF EXISTS idx_tenant_region`;
    await db`ALTER TABLE tenant DROP COLUMN IF EXISTS region`;
  },
};

export default migration;
