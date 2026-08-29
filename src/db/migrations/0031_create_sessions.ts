import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0031_create_sessions",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("sessions", (table) => {
        table.string("id").primary();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.timestamp("expires_at");
        table.index(["user_id"], { name: "idx_sessions_user_id" });
        table.index(["expires_at"], { name: "idx_sessions_expires_at" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("sessions");
    });
  },
};

export default migration;
