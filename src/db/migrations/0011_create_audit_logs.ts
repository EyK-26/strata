import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0011_create_audit_logs",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("audit_log", (table) => {
        table.id();
        table.foreignId("user_id").nullable().constrained("users").nullOnDelete();
        table.string("action");
        table.string("subject_type");
        table.integer("subject_id").nullable();
        table.jsonb("payload").defaultRaw("'{}'::jsonb");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["created_at"], { name: "idx_audit_log_created_at", order: "desc" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("audit_log");
    });
  },
};

export default migration;
