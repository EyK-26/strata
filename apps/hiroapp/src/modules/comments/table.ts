import { defineTable } from "@getstrata/core/database/table";

export interface CommentRecord {
  id: number;
  user_id: number;
  body: string;
  commentable_type: string;
  commentable_id: number;
  created_at: Date | null;
  updated_at: Date | null;
  tenant_id?: number | null;
}

export const commentTable = defineTable<CommentRecord, "id">({
  name: "comments",
  primaryKey: "id",
  columns: [
    "id",
    "user_id",
    "body",
    "commentable_type",
    "commentable_id",
    "created_at",
    "updated_at",
    "tenant_id",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
