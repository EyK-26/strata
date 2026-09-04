import { defineTable } from "@getstrata/core/database/table";

export type InterviewStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "declined";

export interface InterviewRecord {
  id: number;
  application_id: number;
  created_by: number;
  tenant_id?: number | null;
  scheduled_at: Date;
  place: string | null;
  notes: string | null;
  status: InterviewStatus;
  created_at: Date | null;
  updated_at: Date | null;
}

export const interviewTable = defineTable<InterviewRecord, "id">({
  name: "interviews",
  primaryKey: "id",
  columns: [
    "id",
    "application_id",
    "created_by",
    "tenant_id",
    "scheduled_at",
    "place",
    "notes",
    "status",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "scheduled_at", direction: "ASC" },
});
