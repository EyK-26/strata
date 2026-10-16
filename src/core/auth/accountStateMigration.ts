import { guardMigrationRollback } from "../database/migrations/rollbackGuard";
import type { Migration } from "../database/migrations/types";
import { Schema } from "../database/schema";
import type { DatabaseDriver } from "../database/schema/driver";

/** Explicit additive adoption for the standard users table; never runs during authentication. */
function createAccountStateMigration(
  name: string,
  driver: DatabaseDriver,
  options: { sessions?: boolean } = {},
): Migration {
  return {
    name,
    async up(db) {
      await Schema.run(db, driver, (schema) => {
        schema.table("users", (table) => {
          table.boolean("is_active").default(true);
          table.integer("auth_version").default(0).check("auth_version >= 0");
        });
        if (options.sessions)
          schema.table("sessions", (table) => {
            table.integer("auth_version").default(0).check("auth_version >= 0");
          });
      });
    },
    async down(db, context) {
      await guardMigrationRollback(context, {
        hasHistory: () => true,
        message:
          "Removing account state requires an explicit administrative credential-reset procedure.",
      });
      await Schema.run(db, driver, (schema) => {
        schema.table("users", (table) => {
          table.dropColumn("auth_version");
          table.dropColumn("is_active");
        });
        if (options.sessions) schema.table("sessions", (table) => table.dropColumn("auth_version"));
      });
    },
  };
}

export { createAccountStateMigration };
