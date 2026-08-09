import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0002_create_project",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("project", (table) => {
        table.id();
        table.foreignId("organization_id").constrained("organization").cascadeOnDelete();
        table.string("name");
        table.string("status").default("draft").check("status IN ('draft', 'active', 'archived')");
        table.timestamps();
        table.unique(["organization_id", "name"]);
        table.index(["organization_id"], { name: "idx_project_organization_id" });
        table.index(["status"], { name: "idx_project_status" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("project");
    });
  },
};

export default migration;
