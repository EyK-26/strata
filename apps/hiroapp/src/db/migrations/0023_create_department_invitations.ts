import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0023_create_department_invitations",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("department_invitations", (table) => {
        table.id();
        table.foreignId("department_id").constrained("departments").cascadeOnDelete();
        table.string("email");
        table.string("role").default("member").check("role IN ('owner', 'member')");
        table.foreignId("invited_by").constrained("users").cascadeOnDelete();
        table.string("token_hash");
        table.timestamp("expires_at");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.unique(["department_id", "email"], "department_invitation_dept_email_unique");
        table.index(["email"], { name: "idx_department_invitations_email" });
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("department_invitations");
    });
  },
};

export default migration;
