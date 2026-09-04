import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0043_create_candidate_merges",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("candidate_merges", (table) => {
        table.id();
        table.foreignId("source_user_id").constrained("users");
        table.foreignId("target_user_id").constrained("users");
        table.foreignId("merged_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.integer("applications_moved").default(0);
        table.integer("applications_skipped").default(0);
        table
          .string("pool_action")
          .default("unchanged")
          .check("pool_action IN ('retargeted', 'released_source', 'kept_target', 'unchanged')");
        table.timestamps();
        table.index(["tenant_id"], { name: "idx_candidate_merges_tenant_id" });
        table.index(["target_user_id"], { name: "idx_candidate_merges_target_user_id" });
      });
    });
    await isolateTenantTable(db, "candidate_merges");
  },
  async down(db) {
    await dropTenantIsolation(db, "candidate_merges");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("candidate_merges");
    });
  },
};

export default migration;
