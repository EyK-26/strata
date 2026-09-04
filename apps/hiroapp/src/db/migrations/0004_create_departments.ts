import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0004_create_departments",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("departments", (table) => {
        table.id();
        table.string("name").unique();
        table.timestamps();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("departments");
    });
  },
};

export default migration;
