import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0022_add_user_tenant_id",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.foreignId("tenant_id").nullable().constrained("tenant");
      });
    });

    await db.unsafe(
      `
      UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL
    `,
      [],
    );
    await db.unsafe(
      `
      ALTER TABLE users
      ALTER COLUMN tenant_id SET NOT NULL
    `,
      [],
    );
    await db.unsafe(
      `
      CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)
    `,
      [],
    );
    await db.unsafe(
      `
      INSERT INTO tenant (id, name, slug, plan, region)
      VALUES (2, 'Isolated Tenant', 'isolated', 'free', 'us')
      ON CONFLICT (id) DO NOTHING
    `,
      [],
    );
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.dropIndex("idx_users_tenant_id");
        table.dropColumn("tenant_id");
      });
    });
  },
};

export default migration;
