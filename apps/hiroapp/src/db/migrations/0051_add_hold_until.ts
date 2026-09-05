import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0051_add_hold_until",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("application_holds", (table) => {
        table.timestamp("holds_until").nullable();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("application_holds", (table) => {
        table.dropColumn("holds_until");
      });
    });
  },
};

export default migration;
