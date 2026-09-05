import { defineTable } from "@getstrata/core/database/table";

export type HoldStatus = "holding" | "released";

export interface ApplicationHoldRecord {
  id: number;
  application_id: number;
  created_by: number;
  released_by: number | null;
  tenant_id?: number | null;
  notes: string | null;
  status: HoldStatus;
  holds_until: Date | null;
  released_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const applicationHoldTable = defineTable<ApplicationHoldRecord, "id">({
  name: "application_holds",
  primaryKey: "id",
  columns: [
    "id",
    "application_id",
    "created_by",
    "released_by",
    "tenant_id",
    "notes",
    "status",
    "holds_until",
    "released_at",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
