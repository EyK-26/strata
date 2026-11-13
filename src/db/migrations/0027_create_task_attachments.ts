import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0027_create_task_attachments",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("task_attachment", (table) => {
        table.id();
        table.foreignId("task_id").constrained("task").cascadeOnDelete();
        table.foreignId("tenant_id").constrained("tenant");
        table.foreignId("user_id").constrained("users");
        table.string("original_name");
        table.string("storage_path").unique();
        table.string("mime_type");
        table.bigInteger("size_bytes").check("size_bytes > 0");
        table.timestamp("created_at").defaultRaw("NOW()");
        table.softDeletes();
        table.index(["task_id"], { name: "idx_task_attachment_task_id" });
        table.index(["tenant_id"], { name: "idx_task_attachment_tenant_id" });
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("task_attachment");
    });
  },
};

export default migration;
