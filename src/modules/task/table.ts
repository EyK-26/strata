import { defineTable } from "@getstrata/core/database";
import { TASK_TABLE } from "../../domain/workhub";
import type { TaskRecord } from "./types";

const taskTable = defineTable<TaskRecord, "id">({
  name: TASK_TABLE,
  primaryKey: "id",
  columns: [
    "id",
    "project_id",
    "tenant_id",
    "title",
    "status",
    "priority",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  softDeletes: true,
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { taskTable };
