import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0053_add_career_pin",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("career_postings", (table) => {
        table.boolean("pinned").default(false);
      });
    });
    await db.unsafe(`UPDATE career_postings SET pinned = FALSE WHERE pinned IS NULL`);
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("career_postings", (table) => {
        table.dropColumn("pinned");
      });
    });
  },
};

export default migration;
