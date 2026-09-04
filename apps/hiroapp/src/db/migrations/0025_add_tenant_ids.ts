import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const TENANT_TABLES = [
  "users",
  "departments",
  "positions",
  "applications",
  "notifications",
  "comments",
  "department_members",
  "department_invitations",
  "api_token",
] as const;

const migration: Migration = {
  name: "0025_add_tenant_ids",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      for (const tableName of TENANT_TABLES) {
        schema.table(tableName, (table) => {
          table.foreignId("tenant_id").nullable().constrained("tenant");
          table.index(["tenant_id"], { name: `idx_${tableName}_tenant_id` });
        });
      }
    });

    for (const tableName of TENANT_TABLES) {
      await db.unsafe(`UPDATE ${tableName} SET tenant_id = 1 WHERE tenant_id IS NULL`);
      await db.unsafe(`ALTER TABLE ${tableName} ALTER COLUMN tenant_id SET DEFAULT 1`);
      await db.unsafe(`ALTER TABLE ${tableName} ALTER COLUMN tenant_id SET NOT NULL`);
    }

    await db.unsafe(`ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_name_key`);
    await db.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_name_unique
      ON departments (tenant_id, name)
    `);
  },
  async down(db) {
    await db.unsafe(`DROP INDEX IF EXISTS departments_tenant_name_unique`);
    await Schema.run(db, "pgsql", (schema) => {
      for (const tableName of [...TENANT_TABLES].reverse()) {
        schema.table(tableName, (table) => {
          table.dropIndex(`idx_${tableName}_tenant_id`);
          table.dropColumn("tenant_id");
        });
      }
    });
  },
};

export default migration;
