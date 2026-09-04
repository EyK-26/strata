import { defineTable } from "@getstrata/core/database/table";

export type CareerPostingStatus = "published" | "unpublished" | "expired";

export interface CareerPostingRecord {
  id: number;
  position_id: number;
  published_by: number;
  tenant_id?: number | null;
  status: CareerPostingStatus;
  expires_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const careerPostingTable = defineTable<CareerPostingRecord, "id">({
  name: "career_postings",
  primaryKey: "id",
  columns: [
    "id",
    "position_id",
    "published_by",
    "tenant_id",
    "status",
    "expires_at",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
