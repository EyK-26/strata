import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0014_create_tenants",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("tenant", (table) => {
        table.id();
        table.string("name");
        table.string("slug").unique();
        table.string("plan").default("free").check("plan IN ('free', 'pro', 'enterprise')");
        table.timestamp("created_at").defaultRaw("NOW()");
      });

      schema.table("organization", (table) => {
        table.foreignId("tenant_id").nullable().constrained("tenant");
      });
    });

    await db`
      INSERT INTO tenant (id, name, slug, plan)
      VALUES (1, 'Default Tenant', 'default', 'enterprise')
      ON CONFLICT (id) DO NOTHING
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
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("organization", (table) => {
        table.dropColumn("tenant_id");
      });
      schema.drop("tenant");
    });
  },
};

export default migration;
