import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0040_create_position_requisitions",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("position_requisitions", (table) => {
        table.id();
        table.foreignId("position_id").constrained("positions").cascadeOnDelete();
        table.foreignId("requested_by").constrained("users");
        table.foreignId("approved_by").nullable().constrained("users").nullOnDelete();
        table.foreignId("tenant_id").constrained("tenant");
        table.text("notes").nullable();
        table
          .string("status")
          .default("submitted")
          .check("status IN ('submitted', 'approved', 'rejected')");
        table.timestamps();
        table.unique(["position_id"], "position_requisitions_position_id_unique");
        table.index(["tenant_id"], { name: "idx_position_requisitions_tenant_id" });
      });
    });
    await isolateTenantTable(db, "position_requisitions");
  },
  async down(db) {
    await dropTenantIsolation(db, "position_requisitions");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("position_requisitions");
    });
  },
};

export default migration;
