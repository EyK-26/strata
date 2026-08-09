import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0023_user_security_fields",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("users", (table) => {
        table.timestamp("email_verified_at").nullable().defaultRaw("NOW()");
        table.string("mfa_secret").nullable();
        table.boolean("mfa_enabled").default(false);
      });
    });

    await db`
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, created_at)
      WHERE email_verified_at IS NULL
    `;
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("email_verified_at");
        table.dropColumn("mfa_secret");
        table.dropColumn("mfa_enabled");
      });
    });
  },
};

export default migration;
