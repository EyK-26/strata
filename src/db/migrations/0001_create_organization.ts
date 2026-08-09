import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0001_create_organization",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("organization", (table) => {
        table.id();
        table.string("name");
        table.string("slug").unique();
        table.timestamps();
        table.index(["slug"], { name: "idx_organization_slug" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("organization");
    });
  },
};

export default migration;
