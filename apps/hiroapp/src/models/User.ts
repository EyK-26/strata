import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface UserRecord {
  id: number;
  name: string;
  email: string;
  password: string;
  is_admin: number | boolean;
  tenant_id: number;
  mfa_secret: string | null;
  mfa_enabled: number | boolean;
  mfa_recovery_codes: string | null;
  session_valid_after: Date | string | null;
  email_verified_at: Date | string | null;
  created_at: Date | string;
}

const usersTable = defineTable<UserRecord, "id">({
  name: "users",
  primaryKey: "id",
  columns: [
    "id",
    "name",
    "email",
    "password",
    "is_admin",
    "tenant_id",
    "mfa_secret",
    "mfa_enabled",
    "mfa_recovery_codes",
    "session_valid_after",
    "email_verified_at",
    "created_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class UserRepository extends BaseRepository<UserRecord, "id"> {
  constructor() {
    super(usersTable);
  }
}

class User extends Model<UserRecord, "id"> {
  static $fillable = [
    "name",
    "email",
    "password",
    "is_admin",
    "tenant_id",
    "mfa_secret",
    "mfa_enabled",
    "mfa_recovery_codes",
    "session_valid_after",
    "email_verified_at",
  ] as const;
  static $hidden = ["password", "mfa_secret", "mfa_recovery_codes"] as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

registerModelRepository(User, new UserRepository());

export type { UserRecord };
export { User };
