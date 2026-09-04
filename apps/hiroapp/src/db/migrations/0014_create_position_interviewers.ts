import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0014_create_position_interviewers",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("position_interviewers", (table) => {
        table.bigInteger("position_id");
        table.bigInteger("user_id");
        table.string("role").default("panel");
        table.unique(["position_id", "user_id"]);
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("position_interviewers");
    });
  },
};

export default migration;
