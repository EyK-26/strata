import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0016_extend_audit_logs",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("audit_log", (table) => {
        table.jsonb("previous_payload").nullable();
        table.string("ip_address").nullable();
        table.string("user_agent").nullable();
        table.string("checksum").nullable();
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("audit_log", (table) => {
        table.dropColumn("checksum");
        table.dropColumn("user_agent");
        table.dropColumn("ip_address");
        table.dropColumn("previous_payload");
      });
    });
  },
};

export default migration;
