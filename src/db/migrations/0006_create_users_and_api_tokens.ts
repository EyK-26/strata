import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0006_create_users_and_api_tokens",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("users", (table) => {
        table.id();
        table.string("name");
        table.string("email").unique();
        table.string("role").check("role IN ('admin', 'member')");
        table.timestamps();
      });

      schema.create("api_token", (table) => {
        table.id();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.string("name");
        table.string("token_hash").unique();
        table.timestamp("last_used_at").nullable();
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["token_hash"], { name: "idx_api_token_hash" });
        table.index(["user_id"], { name: "idx_api_token_user_id" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("api_token");
      schema.drop("users");
    });
  },
};

export default migration;
