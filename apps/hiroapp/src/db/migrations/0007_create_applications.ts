import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0007_create_applications",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("applications", (table) => {
        table.id();
        table.bigInteger("user_id");
        table.bigInteger("position_id").nullable();
        table.bigInteger("status_id");
        table.text("attachment_text").nullable();
        table.string("attachment_file").nullable();
        table.timestamps();
        table.unique(["user_id", "position_id"]);
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("applications");
    });
  },
};

export default migration;
