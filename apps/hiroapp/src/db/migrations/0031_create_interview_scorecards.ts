import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0031_create_interview_scorecards",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("interview_scorecards", (table) => {
        table.id();
        table.foreignId("interview_id").constrained("interviews").cascadeOnDelete();
        table.foreignId("user_id").constrained("users");
        table.foreignId("tenant_id").constrained("tenant");
        table.integer("overall_score").check("overall_score BETWEEN 1 AND 5");
        table.string("recommendation").check("recommendation IN ('hire', 'no_hire', 'hold')");
        table.text("notes").nullable();
        table.timestamps();
        table.unique(["interview_id", "user_id"]);
        table.index(["interview_id"], { name: "idx_interview_scorecards_interview_id" });
        table.index(["tenant_id"], { name: "idx_interview_scorecards_tenant_id" });
      });
    });
    await isolateTenantTable(db, "interview_scorecards");
  },
  async down(db) {
    await dropTenantIsolation(db, "interview_scorecards");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("interview_scorecards");
    });
  },
};

export default migration;
