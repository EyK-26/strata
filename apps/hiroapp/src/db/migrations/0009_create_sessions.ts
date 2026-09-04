import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0009_create_sessions",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("sessions", (table) => {
        table.string("id").primary();
        table.bigInteger("user_id");
        table.timestamp("expires_at");
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("sessions");
    });
  },
};

export default migration;
