import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0033_create_organization_invitations",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("organization_invitation", (table) => {
        table.id();
        table.foreignId("organization_id").constrained("organization").cascadeOnDelete();
        table.string("email");
        table.string("role").default("member").check("role IN ('owner', 'admin', 'member')");
        table.foreignId("invited_by").constrained("users").cascadeOnDelete();
        table.string("token_hash");
        table.timestamp("expires_at");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.unique(["organization_id", "email"], "organization_invitation_org_email_unique");
        table.index(["email"], { name: "idx_organization_invitation_email" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("organization_invitation");
    });
  },
};

export default migration;
