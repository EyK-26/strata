import { defineTable } from "@getstrata/core/database/table";

export interface ApplicationRecord {
  id: number;
  user_id: number;
  position_id: number | null;
  status_id: number;
  attachment_text: string | null;
  attachment_file: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  deleted_at: Date | null;
}

export const applicationTable = defineTable<ApplicationRecord, "id">({
  name: "applications",
  primaryKey: "id",
  columns: [
    "id",
    "user_id",
    "position_id",
    "status_id",
    "attachment_text",
    "attachment_file",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
  softDeletes: true,
});
