import { defineTable } from "@getstrata/core/database/table";

export interface SkillRecord {
  id: number;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface SkillUserRecord {
  user_id: number;
  skill_id: number;
  years: number;
  level: string;
}

export interface PositionSkillRecord {
  position_id: number;
  skill_id: number;
  required: boolean;
  weight: number;
}

export const skillTable = defineTable<SkillRecord, "id">({
  name: "skills",
  primaryKey: "id",
  columns: ["id", "name", "created_at", "updated_at"],
  defaultOrderBy: { column: "name", direction: "ASC" },
});
