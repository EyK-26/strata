import { defineTable } from "@getstrata/core/database/table";

export type RequisitionStatus = "submitted" | "approved" | "rejected";

export interface RequisitionRecord {
  id: number;
  position_id: number;
  requested_by: number;
  approved_by: number | null;
  tenant_id?: number | null;
  notes: string | null;
  status: RequisitionStatus;
  created_at: Date | null;
  updated_at: Date | null;
}

export const requisitionTable = defineTable<RequisitionRecord, "id">({
  name: "position_requisitions",
  primaryKey: "id",
  columns: [
    "id",
    "position_id",
    "requested_by",
    "approved_by",
    "tenant_id",
    "notes",
    "status",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
