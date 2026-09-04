import { defineTable } from "@getstrata/core/database/table";

export interface CandidateTagRecord {
  id: number;
  user_id: number;
  created_by: number;
  tenant_id?: number | null;
  label: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export const candidateTagTable = defineTable<CandidateTagRecord, "id">({
  name: "candidate_tags",
  primaryKey: "id",
  columns: ["id", "user_id", "created_by", "tenant_id", "label", "created_at", "updated_at"],
  defaultOrderBy: { column: "label", direction: "ASC" },
});
