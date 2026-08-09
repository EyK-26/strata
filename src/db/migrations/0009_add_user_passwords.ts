import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0009_add_user_passwords",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("users", (table) => {
        table.string("password_hash").nullable();
      });
    });
    await db`
      UPDATE users
      SET password_hash = ''
      WHERE password_hash IS NULL
    `;
    await db`
      ALTER TABLE users
      ALTER COLUMN password_hash SET NOT NULL
    `;
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("password_hash");
      });
    });
  },
};

export default migration;
