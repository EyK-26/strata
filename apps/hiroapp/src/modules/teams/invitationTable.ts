import { defineTable } from "@getstrata/core/database/table";
import type { TeamRole } from "./memberTable.ts";

export interface DepartmentInvitationRecord {
  id: number;
  department_id: number;
  email: string;
  role: TeamRole | string;
  invited_by: number;
  token_hash: string;
  expires_at: Date | string;
  created_at: Date | string;
}

export const departmentInvitationTable = defineTable<DepartmentInvitationRecord, "id">({
  name: "department_invitations",
  primaryKey: "id",
  columns: [
    "id",
    "department_id",
    "email",
    "role",
    "invited_by",
    "token_hash",
    "expires_at",
    "created_at",
  ],
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});
