import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0001_create_roles",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("roles", (table) => {
        table.id();
        table.string("name").unique();
        table.timestamps();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("roles");
    });
  },
};

export default migration;
