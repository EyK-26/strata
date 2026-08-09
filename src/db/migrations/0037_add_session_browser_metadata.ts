import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0037_add_session_browser_metadata",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("sessions", (table) => {
        table.text("user_agent").nullable();
        table.text("ip_address").nullable();
        table.timestamp("last_active_at").nullable();
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("sessions", (table) => {
        table.dropColumn("user_agent");
        table.dropColumn("ip_address");
        table.dropColumn("last_active_at");
      });
    });
  },
};

export default migration;
