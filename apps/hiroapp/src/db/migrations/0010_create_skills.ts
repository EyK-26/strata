import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0010_create_skills",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("skills", (table) => {
        table.id();
        table.string("name").unique();
        table.timestamps();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("skills");
    });
  },
};

export default migration;
