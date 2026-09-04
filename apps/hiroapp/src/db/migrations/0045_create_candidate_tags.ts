import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0045_create_candidate_tags",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("candidate_tags", (table) => {
        table.id();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.string("label");
        table.timestamps();
        table.unique(["user_id", "label"], "candidate_tags_user_id_label_unique");
        table.index(["tenant_id"], { name: "idx_candidate_tags_tenant_id" });
        table.index(["user_id"], { name: "idx_candidate_tags_user_id" });
      });
    });
    await isolateTenantTable(db, "candidate_tags");
  },
  async down(db) {
    await dropTenantIsolation(db, "candidate_tags");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("candidate_tags");
    });
  },
};

export default migration;
