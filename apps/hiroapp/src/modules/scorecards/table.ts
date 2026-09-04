import { defineTable } from "@getstrata/core/database/table";

export type ScorecardRecommendation = "hire" | "no_hire" | "hold";

export interface ScorecardRecord {
  id: number;
  interview_id: number;
  user_id: number;
  tenant_id?: number | null;
  overall_score: number;
  recommendation: ScorecardRecommendation;
  notes: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const scorecardTable = defineTable<ScorecardRecord, "id">({
  name: "interview_scorecards",
  primaryKey: "id",
  columns: [
    "id",
    "interview_id",
    "user_id",
    "tenant_id",
    "overall_score",
    "recommendation",
    "notes",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
