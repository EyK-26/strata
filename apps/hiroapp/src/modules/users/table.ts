import { defineTable } from "@getstrata/core/database/table";

export interface UserRecord {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role_id: number;
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
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "last_name", direction: "ASC" },
});
