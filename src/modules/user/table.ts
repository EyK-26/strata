import { defineTable } from "@getstrata/core/database/table";
import type { UserRecord } from "./types";

const userTable = defineTable<UserRecord, "id">({
  name: "users",
  primaryKey: "id",
  columns: [
    "id",
    "name",
    "email",
    "email_lookup",
    "role",
    "tenant_id",
    "password_hash",
    "email_verified_at",
    "mfa_secret",
    "mfa_enabled",
    "mfa_recovery_codes",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { userTable };
