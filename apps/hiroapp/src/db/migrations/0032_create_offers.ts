import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0032_create_offers",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("offers", (table) => {
        table.id();
        table.foreignId("application_id").constrained("applications").cascadeOnDelete();
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.integer("salary");
        table.timestamp("starts_on").nullable();
        table
          .string("status")
          .default("draft")
          .check("status IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn')");
        table.text("notes").nullable();
        table.timestamps();
        table.index(["application_id"], { name: "idx_offers_application_id" });
        table.index(["tenant_id"], { name: "idx_offers_tenant_id" });
      });
    });
    await isolateTenantTable(db, "offers");
  },
  async down(db) {
    await dropTenantIsolation(db, "offers");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("offers");
    });
  },
};

export default migration;
