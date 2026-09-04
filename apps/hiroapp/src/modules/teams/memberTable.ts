import { defineTable } from "@getstrata/core/database/table";

export type TeamRole = "owner" | "member";

export interface DepartmentMemberRecord {
  id: number;
  department_id: number;
  user_id: number;
  role: TeamRole | string;
  created_at: Date | string | null;
  tenant_id?: number | null;
}

export const departmentMemberTable = defineTable<DepartmentMemberRecord, "id">({
  name: "department_members",
  primaryKey: "id",
  columns: ["id", "department_id", "user_id", "role", "created_at", "tenant_id"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
