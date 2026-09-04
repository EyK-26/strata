import { defineTable } from "@getstrata/core/database/table";

export interface UserRecord {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role_id: number;
  email_verified_at?: Date | null;
  mfa_secret?: string | null;
  mfa_enabled?: boolean;
  mfa_recovery_codes?: string | null;
  profile_photo_path?: string | null;
  session_valid_after?: Date | null;
  current_department_id?: number | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const userTable = defineTable<UserRecord, "id">({
  name: "users",
  primaryKey: "id",
  columns: [
    "id",
    "first_name",
    "last_name",
    "email",
    "password",
    "role_id",
    "email_verified_at",
    "mfa_secret",
    "mfa_enabled",
    "mfa_recovery_codes",
    "profile_photo_path",
    "session_valid_after",
    "current_department_id",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "last_name", direction: "ASC" },
});
