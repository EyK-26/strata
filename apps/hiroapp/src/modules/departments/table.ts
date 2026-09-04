import { defineTable } from "@getstrata/core/database/table";

export interface DepartmentRecord {
  id: number;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export const departmentTable = defineTable<DepartmentRecord, "id">({
  name: "departments",
  primaryKey: "id",
  columns: ["id", "name", "created_at", "updated_at"],
  defaultOrderBy: { column: "name", direction: "ASC" },
});
