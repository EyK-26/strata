import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0011_create_skill_user",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("skill_user", (table) => {
        table.bigInteger("user_id");
        table.bigInteger("skill_id");
        table.integer("years").default(0);
        table.string("level").default("intermediate");
        table.unique(["user_id", "skill_id"]);
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("skill_user");
    });
  },
};

export default migration;
