import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0039_create_background_checks",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("background_checks", (table) => {
        table.id();
        table.foreignId("application_id").constrained("applications").cascadeOnDelete();
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.string("vendor").nullable();
        table.text("notes").nullable();
        table
          .string("status")
          .default("requested")
          .check("status IN ('requested', 'clear', 'flagged', 'cancelled')");
        table.timestamp("completed_at").nullable();
        table.timestamps();
        table.unique(["application_id"], "background_checks_application_id_unique");
        table.index(["tenant_id"], { name: "idx_background_checks_tenant_id" });
      });
    });
    await isolateTenantTable(db, "background_checks");
  },
  async down(db) {
    await dropTenantIsolation(db, "background_checks");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("background_checks");
    });
  },
};

export default migration;
