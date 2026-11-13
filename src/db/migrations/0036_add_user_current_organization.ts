import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0036_add_user_current_organization",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table
          .foreignId("current_organization_id")
          .nullable()
          .constrained("organization")
          .nullOnDelete();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("current_organization_id");
      });
    });
  },
};

export default migration;
