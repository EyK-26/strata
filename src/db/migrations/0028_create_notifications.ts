import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0028_create_notifications",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("notification", (table) => {
        table.id();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.foreignId("tenant_id").constrained("tenant");
        table.string("type");
        table.string("title");
        table.text("body");
        table.jsonb("data").defaultRaw("'{}'::jsonb");
        table.timestamp("read_at").nullable();
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["user_id"], { name: "idx_notification_user_id" });
        table.partialIndex(["user_id"], "read_at IS NULL", "idx_notification_user_unread");
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("notification");
    });
  },
};

export default migration;
