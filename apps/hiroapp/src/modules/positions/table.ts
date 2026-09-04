import { defineTable } from "@getstrata/core/database/table";

export interface PositionRecord {
  id: number;
  user_id: number | null;
  department_id: number;
  grade_id: number;
  name: string;
  description: string | null;
  hiring: boolean;
  start_date: Date | null;
  end_date: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  deleted_at: Date | null;
}

export const positionTable = defineTable<PositionRecord, "id">({
  name: "positions",
  primaryKey: "id",
  columns: [
    "id",
    "user_id",
    "department_id",
    "grade_id",
    "name",
    "description",
    "hiring",
    "start_date",
    "end_date",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
  softDeletes: true,
});
