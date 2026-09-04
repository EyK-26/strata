import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0041_create_onboarding_items",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("onboarding_items", (table) => {
        table.id();
        table.foreignId("application_id").constrained("applications").cascadeOnDelete();
        table.foreignId("created_by").constrained("users");
        table.foreignId("completed_by").nullable().constrained("users").nullOnDelete();
        table.foreignId("tenant_id").constrained("tenant");
        table.string("title");
        table.text("notes").nullable();
        table.string("status").default("open").check("status IN ('open', 'done')");
        table.timestamp("completed_at").nullable();
        table.timestamps();
        table.index(["application_id"], { name: "idx_onboarding_items_application_id" });
        table.index(["tenant_id"], { name: "idx_onboarding_items_tenant_id" });
      });
    });
    await isolateTenantTable(db, "onboarding_items");
  },
  async down(db) {
    await dropTenantIsolation(db, "onboarding_items");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("onboarding_items");
    });
  },
};

export default migration;
