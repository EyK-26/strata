import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0005_create_users",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("users", (table) => {
        table.id();
        table.string("first_name");
        table.string("last_name");
        table.string("email").unique();
        table.string("password");
        table.bigInteger("role_id");
        table.timestamps();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("users");
    });
  },
};

export default migration;
