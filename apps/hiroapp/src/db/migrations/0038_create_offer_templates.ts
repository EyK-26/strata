import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0038_create_offer_templates",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("offer_templates", (table) => {
        table.id();
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.string("name");
        table.text("body");
        table.integer("salary").nullable();
        table.timestamps();
        table.index(["tenant_id"], { name: "idx_offer_templates_tenant_id" });
      });
    });
    await isolateTenantTable(db, "offer_templates");
  },
  async down(db) {
    await dropTenantIsolation(db, "offer_templates");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("offer_templates");
    });
  },
};

export default migration;
