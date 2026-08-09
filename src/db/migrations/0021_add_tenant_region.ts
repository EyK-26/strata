import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0021_add_tenant_region",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("tenant", (table) => {
        table.string("region").default("eu").check("region IN ('eu', 'us', 'apac')");
        table.index(["region"], { name: "idx_tenant_region" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.table("tenant", (table) => {
        table.dropIndex("idx_tenant_region");
        table.dropColumn("region");
      });
    });
  },
};

export default migration;
