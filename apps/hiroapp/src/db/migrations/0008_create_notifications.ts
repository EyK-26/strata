import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0008_create_notifications",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("notifications", (table) => {
        table.string("id").primary();
        table.string("type");
        table.string("notifiable_type");
        table.bigInteger("notifiable_id");
        table.jsonb("data");
        table.timestamp("read_at").nullable();
        table.timestamps();
        table.index("notifiable_id");
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("notifications");
    });
  },
};

export default migration;
