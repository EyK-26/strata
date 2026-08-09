import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const tables = ["organization", "project", "task", "comment"] as const;

const migration: Migration = {
  name: "0005_add_soft_deletes",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      for (const tableName of tables) {
        schema.table(tableName, (table) => {
          table.softDeletes();
          table.index(["deleted_at"], { name: `idx_${tableName}_deleted_at` });
        });
      }
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      for (const tableName of [...tables].reverse()) {
        schema.table(tableName, (table) => {
          table.dropSoftDeletes();
        });
      }
    });
  },
};

export default migration;
