import { defineTable } from "@getstrata/core/database/table";

export type CareerPostingStatus = "published" | "unpublished";

export interface CareerPostingRecord {
  id: number;
  position_id: number;
  published_by: number;
  tenant_id?: number | null;
  status: CareerPostingStatus;
  created_at: Date | null;
  updated_at: Date | null;
}

export const careerPostingTable = defineTable<CareerPostingRecord, "id">({
  name: "career_postings",
  primaryKey: "id",
  columns: ["id", "position_id", "published_by", "tenant_id", "status", "created_at", "updated_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
