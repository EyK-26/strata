import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0034_create_referrals",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("referrals", (table) => {
        table.id();
        table.foreignId("position_id").constrained("positions").cascadeOnDelete();
        table.foreignId("referred_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.string("email");
        table.string("name");
        table.text("notes").nullable();
        table.string("status").default("open").check("status IN ('open', 'applied', 'closed')");
        table.timestamps();
        table.index(["position_id"], { name: "idx_referrals_position_id" });
        table.index(["tenant_id"], { name: "idx_referrals_tenant_id" });
        table.index(["email"], { name: "idx_referrals_email" });
      });
    });
    await isolateTenantTable(db, "referrals");
  },
  async down(db) {
    await dropTenantIsolation(db, "referrals");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("referrals");
    });
  },
};

export default migration;
