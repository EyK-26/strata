import type { Migration } from "@getstrata/core/database/migrations/types";
import { resolveDatabaseDriver, Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "9999_combination",
  async up(db) {
    await Schema.run(db, resolveDatabaseDriver(), (schema) => {
      schema.create("combination_orders", (table) => {
        table.id();
        table.string("reference");
        table.string("status");
      });
      schema.create("combination_lines", (table) => {
        table.id();
        table.integer("order_id");
        table.string("kind");
        table.integer("score");
        table.softDeletes();
      });
      schema.create("combination_pivot", (table) => {
        table.id();
        table.integer("owner_id");
        table.integer("child_id");
      });
    });
  },
  async down(db) {
    await Schema.run(db, resolveDatabaseDriver(), (schema) => {
      schema.drop("combination_pivot");
      schema.drop("combination_lines");
      schema.drop("combination_orders");
    });
  },
};
export default migration;
