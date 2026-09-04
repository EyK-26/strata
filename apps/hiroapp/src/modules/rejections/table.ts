import { defineTable } from "@getstrata/core/database/table";

export interface RejectionReasonRecord {
  id: number;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface ApplicationRejectionRecord {
  id: number;
  application_id: number;
  reason_id: number;
  created_by: number;
  tenant_id?: number | null;
  notes: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const rejectionReasonTable = defineTable<RejectionReasonRecord, "id">({
  name: "rejection_reasons",
  primaryKey: "id",
  columns: ["id", "name", "created_at", "updated_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export const applicationRejectionTable = defineTable<ApplicationRejectionRecord, "id">({
  name: "application_rejections",
  primaryKey: "id",
  columns: [
    "id",
    "application_id",
    "reason_id",
    "created_by",
    "tenant_id",
    "notes",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
