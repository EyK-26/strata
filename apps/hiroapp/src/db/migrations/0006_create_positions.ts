import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0006_create_positions",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("positions", (table) => {
        table.id();
        table.bigInteger("user_id").nullable().unique();
        table.bigInteger("department_id");
        table.bigInteger("grade_id");
        table.string("name");
        table.text("description").nullable();
        table.boolean("hiring").default(false);
        table.timestamp("start_date").nullable();
        table.timestamp("end_date").nullable();
        table.timestamps();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("positions");
    });
  },
};

export default migration;
