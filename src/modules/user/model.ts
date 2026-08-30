import { Model, registerModelRepository } from "@getstrata/core/database/model";
import UserRepository from "./repository";
import type { UserRecord } from "./types";

class UserModelClass extends Model<UserRecord, "id"> {
  static override $fillable = [
    "name",
    "email",
    "role",
    "tenant_id",
    "password_hash",
    "email_verified_at",
    "mfa_secret",
    "mfa_enabled",
    "mfa_recovery_codes",
    "profile_photo_path",
    "session_valid_after",
    "current_organization_id",
  ] as const;

  static override $casts = {
    email_verified_at: "datetime",
    session_valid_after: "datetime",
    mfa_enabled: "bool",
    created_at: "datetime",
    updated_at: "datetime",
  } as const;

  protected override primaryKey(): "id" {
    return "id";
  }

  get name() {
    return this.get("name");
  }

  get email() {
    return this.get("email");
  }

  get role() {
    return this.get("role");
  }

  get tenantId() {
    return this.get("tenant_id");
  }
}

const userRepository = new UserRepository();

export const UserModel = registerModelRepository(UserModelClass, userRepository);

export { userRepository };
