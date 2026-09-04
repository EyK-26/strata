import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0016_add_soft_deletes",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("applications", (table) => {
        table.softDeletes();
      });
      schema.table("positions", (table) => {
        table.softDeletes();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("applications", (table) => {
        table.dropSoftDeletes();
      });
      schema.table("positions", (table) => {
        table.dropSoftDeletes();
      });
    });
  },
};

export default migration;
