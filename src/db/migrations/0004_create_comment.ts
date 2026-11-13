import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0004_create_comment",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
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
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("comment");
    });
  },
};

export default migration;
