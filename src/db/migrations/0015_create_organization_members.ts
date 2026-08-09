import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0015_create_organization_members",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("organization_member", (table) => {
        table.id();
        table.foreignId("organization_id").constrained("organization").cascadeOnDelete();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.string("role").default("member").check("role IN ('owner', 'admin', 'member')");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.unique(["organization_id", "user_id"]);
        table.index(["organization_id"], { name: "idx_organization_member_org" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("organization_member");
    });
  },
};

export default migration;
