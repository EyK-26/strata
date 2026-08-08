import type { Migration } from "./types";

const migration: Migration = {
  name: "0022_add_user_tenant_id",
  async up(db) {
    await db`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenant(id)
    `;
    await db`
      UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL
    `;
    await db`
      ALTER TABLE users
      ALTER COLUMN tenant_id SET NOT NULL
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)
    `;
    await db`
      INSERT INTO tenant (id, name, slug, plan, region)
      VALUES (2, 'Isolated Tenant', 'isolated', 'free', 'us')
      ON CONFLICT (id) DO NOTHING
    `;
  },
  async down(db) {
    await db`DROP INDEX IF EXISTS idx_users_tenant_id`;
    await db`ALTER TABLE users DROP COLUMN IF EXISTS tenant_id`;
  },
};

export default migration;
