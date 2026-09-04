import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0033_create_application_rejections",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("rejection_reasons", (table) => {
        table.id();
        table.string("name");
        table.timestamps();
        table.unique(["name"]);
      });
      schema.create("application_rejections", (table) => {
        table.id();
        table.foreignId("application_id").constrained("applications").cascadeOnDelete();
        table.foreignId("reason_id").constrained("rejection_reasons");
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.text("notes").nullable();
        table.timestamps();
        table.index(["application_id"], { name: "idx_application_rejections_application_id" });
        table.index(["tenant_id"], { name: "idx_application_rejections_tenant_id" });
      });
    });
    await isolateTenantTable(db, "application_rejections");
  },
  async down(db) {
    await dropTenantIsolation(db, "application_rejections");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("application_rejections");
      schema.drop("rejection_reasons");
    });
  },
};

export default migration;
