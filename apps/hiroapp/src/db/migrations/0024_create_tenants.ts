import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0024_create_tenants",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("tenant", (table) => {
        table.id();
        table.string("name");
        table.string("slug").unique();
        table.string("plan").default("free").check("plan IN ('free', 'pro', 'enterprise')");
        table.string("region").default("eu").check("region IN ('eu', 'us', 'apac')");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["region"], { name: "idx_tenant_region" });
      });
    });
    await db.unsafe(`
      INSERT INTO tenant (id, name, slug, plan, region)
      VALUES
        (1, 'Default Tenant', 'default', 'enterprise', 'eu'),
        (2, 'Isolated Tenant', 'isolated', 'free', 'us')
      ON CONFLICT (slug) DO NOTHING
    `);
    await db.unsafe(`
      SELECT setval(
        pg_get_serial_sequence('tenant', 'id'),
        GREATEST((SELECT MAX(id) FROM tenant), 1)
      )
    `);
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("tenant");
    });
  },
};

export default migration;
