import type { Migration } from "./types";

const migration: Migration = {
  name: "0014_create_tenants",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS tenant (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL DEFAULT 'free'
          CHECK (plan IN ('free', 'pro', 'enterprise')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      INSERT INTO tenant (id, name, slug, plan)
      VALUES (1, 'Default Tenant', 'default', 'enterprise')
      ON CONFLICT (id) DO NOTHING
    `;
    await db`
      ALTER TABLE organization
      ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenant(id)
    `;
    await db`
      UPDATE organization SET tenant_id = 1 WHERE tenant_id IS NULL
    `;
    await db`
      ALTER TABLE organization
      ALTER COLUMN tenant_id SET NOT NULL
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_organization_tenant_id ON organization(tenant_id)
    `;
  },
  async down(db) {
    await db`ALTER TABLE organization DROP COLUMN IF EXISTS tenant_id`;
    await db`DROP TABLE IF EXISTS tenant CASCADE`;
  },
};

export default migration;
