import { defineTable } from "@getstrata/core/database/table";

export type PoolMergeAction = "retargeted" | "released_source" | "kept_target" | "unchanged";

export interface CandidateMergeRecord {
  id: number;
  source_user_id: number;
  target_user_id: number;
  merged_by: number;
  tenant_id?: number | null;
  applications_moved: number;
  applications_skipped: number;
  pool_action: PoolMergeAction;
  created_at: Date | null;
  updated_at: Date | null;
}

export const candidateMergeTable = defineTable<CandidateMergeRecord, "id">({
  name: "candidate_merges",
  primaryKey: "id",
  columns: [
    "id",
    "source_user_id",
    "target_user_id",
    "merged_by",
    "tenant_id",
    "applications_moved",
    "applications_skipped",
    "pool_action",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});
