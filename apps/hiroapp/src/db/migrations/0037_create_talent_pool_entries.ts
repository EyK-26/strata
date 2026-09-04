import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0037_create_talent_pool_entries",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("talent_pool_entries", (table) => {
        table.id();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table
          .foreignId("source_application_id")
          .nullable()
          .constrained("applications")
          .nullOnDelete();
        table.text("notes").nullable();
        table.string("status").default("active").check("status IN ('active', 'released')");
        table.timestamps();
        table.unique(["user_id"], "talent_pool_entries_user_id_unique");
        table.index(["tenant_id"], { name: "idx_talent_pool_entries_tenant_id" });
      });
    });
    await isolateTenantTable(db, "talent_pool_entries");
  },
  async down(db) {
    await dropTenantIsolation(db, "talent_pool_entries");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("talent_pool_entries");
    });
  },
};

export default migration;
