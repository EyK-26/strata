import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0042_create_career_postings",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("career_postings", (table) => {
        table.id();
        table.foreignId("position_id").constrained("positions").cascadeOnDelete();
        table.foreignId("published_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.string("status").default("published").check("status IN ('published', 'unpublished')");
        table.timestamps();
        table.unique(["position_id"], "career_postings_position_id_unique");
        table.index(["tenant_id"], { name: "idx_career_postings_tenant_id" });
      });
    });
    await isolateTenantTable(db, "career_postings");
  },
  async down(db) {
    await dropTenantIsolation(db, "career_postings");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("career_postings");
    });
  },
};

export default migration;
