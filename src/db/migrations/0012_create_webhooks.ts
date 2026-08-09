import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0012_create_webhooks",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("webhook", (table) => {
        table.id();
        table.foreignId("organization_id").nullable().constrained("organization").cascadeOnDelete();
        table.text("url");
        table.text("secret");
        table.jsonb("events").defaultRaw("'[\"*\"]'::jsonb");
        table.boolean("active").default(true);
        table.timestamp("created_at").defaultRaw("NOW()");
      });

      schema.create("webhook_delivery", (table) => {
        table.id();
        table.foreignId("webhook_id").constrained("webhook").cascadeOnDelete();
        table.string("event");
        table.jsonb("payload");
        table.integer("response_status").nullable();
        table.timestamp("created_at").defaultRaw("NOW()");
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("webhook_delivery");
      schema.drop("webhook");
    });
  },
};

export default migration;
