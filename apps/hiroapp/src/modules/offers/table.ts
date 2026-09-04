import { defineTable } from "@getstrata/core/database/table";

export type OfferStatus = "draft" | "sent" | "accepted" | "declined" | "withdrawn";

export interface OfferRecord {
  id: number;
  application_id: number;
  created_by: number;
  tenant_id?: number | null;
  salary: number;
  starts_on: Date | null;
  status: OfferStatus;
  notes: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const offerTable = defineTable<OfferRecord, "id">({
  name: "offers",
  primaryKey: "id",
  columns: [
    "id",
    "application_id",
    "created_by",
    "tenant_id",
    "salary",
    "starts_on",
    "status",
    "notes",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
