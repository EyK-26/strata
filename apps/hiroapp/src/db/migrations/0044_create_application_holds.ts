import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0044_create_application_holds",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("application_holds", (table) => {
        table.id();
        table.foreignId("application_id").constrained("applications").cascadeOnDelete();
        table.foreignId("created_by").constrained("users");
        table.foreignId("released_by").nullable().constrained("users").nullOnDelete();
        table.foreignId("tenant_id").constrained("tenant");
        table.text("notes").nullable();
        table.string("status").default("holding").check("status IN ('holding', 'released')");
        table.timestamp("released_at").nullable();
        table.timestamps();
        table.unique(["application_id"], "application_holds_application_id_unique");
        table.index(["tenant_id"], { name: "idx_application_holds_tenant_id" });
      });
    });
    await isolateTenantTable(db, "application_holds");
  },
  async down(db) {
    await dropTenantIsolation(db, "application_holds");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("application_holds");
    });
  },
};

export default migration;
