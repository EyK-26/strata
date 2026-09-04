import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0022_create_department_members",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("department_members", (table) => {
        table.id();
        table.foreignId("department_id").constrained("departments").cascadeOnDelete();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.string("role").default("member").check("role IN ('owner', 'member')");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.unique(["department_id", "user_id"]);
        table.index(["user_id"], { name: "idx_department_members_user_id" });
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("department_members");
    });
  },
};

export default migration;
