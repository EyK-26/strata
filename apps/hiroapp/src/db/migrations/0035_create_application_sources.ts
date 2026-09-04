import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0035_create_application_sources",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("application_sources", (table) => {
        table.id();
        table.string("name");
        table.timestamps();
        table.unique(["name"]);
      });
      schema.create("application_attributions", (table) => {
        table.id();
        table.foreignId("application_id").constrained("applications").cascadeOnDelete();
        table.foreignId("source_id").constrained("application_sources");
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.text("notes").nullable();
        table.timestamps();
        table.unique(["application_id"], "application_attributions_application_id_unique");
        table.index(["tenant_id"], { name: "idx_application_attributions_tenant_id" });
      });
    });
    await isolateTenantTable(db, "application_attributions");
  },
  async down(db) {
    await dropTenantIsolation(db, "application_attributions");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("application_attributions");
      schema.drop("application_sources");
    });
  },
};

export default migration;
