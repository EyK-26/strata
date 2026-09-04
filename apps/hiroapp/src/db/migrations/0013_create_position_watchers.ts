import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0013_create_position_watchers",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("position_watchers", (table) => {
        table.bigInteger("user_id");
        table.bigInteger("position_id");
        table.unique(["user_id", "position_id"]);
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("position_watchers");
    });
  },
};

export default migration;
