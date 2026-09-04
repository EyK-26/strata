import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0036_create_interview_slots",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("interview_slots", (table) => {
        table.id();
        table.foreignId("position_id").constrained("positions").cascadeOnDelete();
        table.foreignId("created_by").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.timestamp("starts_at");
        table.timestamp("ends_at");
        table.string("status").default("open").check("status IN ('open', 'booked', 'cancelled')");
        table.foreignId("booked_by").nullable().constrained("users").nullOnDelete();
        table.foreignId("interview_id").nullable().constrained("interviews").nullOnDelete();
        table.timestamps();
        table.index(["position_id"], { name: "idx_interview_slots_position_id" });
        table.index(["tenant_id"], { name: "idx_interview_slots_tenant_id" });
      });
    });
    await isolateTenantTable(db, "interview_slots");
  },
  async down(db) {
    await dropTenantIsolation(db, "interview_slots");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("interview_slots");
    });
  },
};

export default migration;
