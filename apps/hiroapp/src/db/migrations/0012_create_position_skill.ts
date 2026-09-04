import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0012_create_position_skill",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("position_skill", (table) => {
        table.bigInteger("position_id");
        table.bigInteger("skill_id");
        table.boolean("required").default(true);
        table.integer("weight").default(1);
        table.unique(["position_id", "skill_id"]);
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("position_skill");
    });
  },
};

export default migration;
