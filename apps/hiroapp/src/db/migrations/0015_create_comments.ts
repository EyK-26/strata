import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0015_create_comments",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("comments", (table) => {
        table.id();
        table.bigInteger("user_id");
        table.text("body");
        table.string("commentable_type");
        table.bigInteger("commentable_id");
        table.timestamps();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("comments");
    });
  },
};

export default migration;
