import { defineTable } from "@getstrata/core/database/table";

export type BackgroundCheckStatus = "requested" | "clear" | "flagged" | "cancelled";

export interface BackgroundCheckRecord {
  id: number;
  application_id: number;
  created_by: number;
  tenant_id?: number | null;
  vendor: string | null;
  notes: string | null;
  status: BackgroundCheckStatus;
  completed_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const backgroundCheckTable = defineTable<BackgroundCheckRecord, "id">({
  name: "background_checks",
  primaryKey: "id",
  columns: [
    "id",
    "application_id",
    "created_by",
    "tenant_id",
    "vendor",
    "notes",
    "status",
    "completed_at",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
