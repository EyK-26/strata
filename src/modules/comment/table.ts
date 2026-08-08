import { defineTable } from "../../core/database";
import { COMMENT_TABLE } from "../../domain/workhub";
import type { CommentRecord } from "./types";

const commentTable = defineTable<CommentRecord, "id">({
  name: COMMENT_TABLE,
  primaryKey: "id",
  columns: ["id", "task_id", "body", "created_at", "deleted_at"],
  softDeletes: true,
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { commentTable };
