import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0048_add_department_hiring_freeze",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("departments", (table) => {
        table.boolean("hiring_frozen").default(false);
      });
    });
    await db.unsafe(`UPDATE departments SET hiring_frozen = FALSE WHERE hiring_frozen IS NULL`);
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("departments", (table) => {
        table.dropColumn("hiring_frozen");
      });
    });
  },
};

export default migration;
