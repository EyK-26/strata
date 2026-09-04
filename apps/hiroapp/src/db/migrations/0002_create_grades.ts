import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0002_create_grades",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("grades", (table) => {
        table.id();
        table.string("name").unique();
        table.timestamps();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("grades");
    });
  },
};

export default migration;
