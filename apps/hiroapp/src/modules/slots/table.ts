import { defineTable } from "@getstrata/core/database/table";

export type SlotStatus = "open" | "booked" | "cancelled";

export interface SlotRecord {
  id: number;
  position_id: number;
  created_by: number;
  tenant_id?: number | null;
  starts_at: Date;
  ends_at: Date;
  status: SlotStatus;
  booked_by: number | null;
  interview_id: number | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const slotTable = defineTable<SlotRecord, "id">({
  name: "interview_slots",
  primaryKey: "id",
  columns: [
    "id",
    "position_id",
    "created_by",
    "tenant_id",
    "starts_at",
    "ends_at",
    "status",
    "booked_by",
    "interview_id",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "starts_at", direction: "ASC" },
});
