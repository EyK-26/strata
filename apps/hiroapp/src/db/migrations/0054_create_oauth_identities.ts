import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0054_create_oauth_identities",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("oauth_identity", (table) => {
        table.id();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.string("provider");
        table.string("provider_user_id");
        table.string("email").nullable();
        table.foreignId("tenant_id").constrained("tenant");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.unique(["provider", "provider_user_id"]);
        table.index(["user_id"], { name: "idx_oauth_identity_user_id" });
      });
    });
    await isolateTenantTable(db, "oauth_identity");
  },
  async down(db) {
    await dropTenantIsolation(db, "oauth_identity");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("oauth_identity");
    });
  },
};

export default migration;
