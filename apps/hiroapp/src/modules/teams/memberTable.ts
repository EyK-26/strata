import { defineTable } from "@getstrata/core/database/table";

export type TeamRole = "owner" | "member";

export interface DepartmentMemberRecord {
  id: number;
  department_id: number;
  user_id: number;
  role: TeamRole | string;
  created_at: Date | string | null;
}

export const departmentMemberTable = defineTable<DepartmentMemberRecord, "id">({
  name: "department_members",
  primaryKey: "id",
  columns: ["id", "department_id", "user_id", "role", "created_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
