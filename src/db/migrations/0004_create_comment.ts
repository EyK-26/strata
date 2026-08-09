import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0004_create_comment",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("comment", (table) => {
        table.id();
        table.foreignId("task_id").constrained("task").cascadeOnDelete();
        table.text("body");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["task_id"], { name: "idx_comment_task_id" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("comment");
    });
  },
};

export default migration;
