import { resolveDatabaseDriver, Schema } from "../../framework/public-api.ts";
import { asMigrationDatabase } from "./migrationDatabase.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0003_create_task",
  async up(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.create("task", (table) => {
        table.id();
        table.foreignId("project_id").constrained("project").cascadeOnDelete();
        table.string("title");
        table.string("status").default("todo").check("status IN ('todo', 'in_progress', 'done')");
        table.integer("priority").default(0).check("priority >= 0 AND priority <= 5");
        table.timestamps();
        table.index(["project_id"], { name: "idx_task_project_id" });
        table.index(["status"], { name: "idx_task_status" });
      });
    });
  },
  async down(db) {
    const migrationDb = asMigrationDatabase(db);
    await Schema.run(migrationDb, resolveDatabaseDriver(), (schema) => {
      schema.drop("task");
    });
  },
};

export default migration;
