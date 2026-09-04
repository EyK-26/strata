import { defineTable } from "@getstrata/core/database/table";

export interface RoleRecord {
  id: number;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface GradeRecord {
  id: number;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface StatusRecord {
  id: number;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export const roleTable = defineTable<RoleRecord, "id">({
  name: "roles",
  primaryKey: "id",
  columns: ["id", "name", "created_at", "updated_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export const gradeTable = defineTable<GradeRecord, "id">({
  name: "grades",
  primaryKey: "id",
  columns: ["id", "name", "created_at", "updated_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export const statusTable = defineTable<StatusRecord, "id">({
  name: "statuses",
  primaryKey: "id",
  columns: ["id", "name", "created_at", "updated_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
