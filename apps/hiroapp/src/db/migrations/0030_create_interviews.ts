import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0030_create_interviews",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("interviews", (table) => {
        table.id();
        table.foreignId("application_id").constrained("applications").cascadeOnDelete();
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.timestamp("scheduled_at");
        table.string("place").nullable();
        table.text("notes").nullable();
        table
          .string("status")
          .default("scheduled")
          .check("status IN ('scheduled', 'confirmed', 'completed', 'cancelled')");
        table.timestamps();
        table.index(["application_id"], { name: "idx_interviews_application_id" });
        table.index(["tenant_id"], { name: "idx_interviews_tenant_id" });
      });
    });
    await isolateTenantTable(db, "interviews");
  },
  async down(db) {
    await dropTenantIsolation(db, "interviews");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("interviews");
    });
  },
};

export default migration;
