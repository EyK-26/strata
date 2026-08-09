import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0007_extend_api_tokens",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("api_token", (table) => {
        table.timestamp("expires_at").nullable();
        table.jsonb("abilities").defaultRaw("'[\"*\"]'::jsonb");
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("api_token", (table) => {
        table.dropColumn("expires_at");
        table.dropColumn("abilities");
      });
    });
  },
};

export default migration;
