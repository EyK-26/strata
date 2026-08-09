import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0036_add_user_current_organization",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("users", (table) => {
        table
          .foreignId("current_organization_id")
          .nullable()
          .constrained("organization")
          .nullOnDelete();
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("current_organization_id");
      });
    });
  },
};

export default migration;
