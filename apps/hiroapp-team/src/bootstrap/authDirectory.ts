import type { AuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import type {
  AuthUserDirectory,
  AuthUserRecord,
} from "@getstrata/core/contracts/authUserDirectory";
import { runWithMigrationBypassForIdentifier } from "@getstrata/core/tenant/databaseTenantContext";
import { User } from "../models/User.ts";

type LoadedUser = {
  get(
    key:
      | "id"
      | "name"
      | "email"
      | "is_admin"
      | "email_verified_at"
      | "password"
      | "session_valid_after",
  ): unknown;
};

function mapRole(isAdmin: unknown): string {
  return isAdmin === true || isAdmin === 1 || isAdmin === "1" ? "admin" : "member";
}

function asTimestamp(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === "string" ? value : null;
}

function mapUserRow(user: LoadedUser): AuthUserRecord {
  return {
    id: Number(user.get("id")),
    name: String(user.get("name") ?? ""),
    email: String(user.get("email") ?? ""),
    role: mapRole(user.get("is_admin")),
    email_verified_at: asTimestamp(user.get("email_verified_at")),
    password: String(user.get("password") ?? ""),
    session_valid_after: asTimestamp(user.get("session_valid_after")),
  };
}

async function findUserById(id: number) {
  return await runWithMigrationBypassForIdentifier(id, async () => {
    const user = await User.find(id);
    if (!user) {
      throw new Error(`User ${id} not found.`);
    }
    return mapUserRow(user);
  });
}

async function findUserByEmail(email: string) {
  email = email.trim().toLowerCase();
  return await runWithMigrationBypassForIdentifier(email, async () => {
    const user = await User.where({ email }).first();
    return user ? mapUserRow(user) : null;
  });
}

export const starterAuthDirectory: AuthUserDirectory = {
  async resolveUserFromToken() {
    return null;
  },

  findByIdOrThrow: findUserById,

  findByEmail: findUserByEmail,

  async verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
    const user = await findUserByEmail(email);
    if (!user?.password || !(await verifyPassword(password, user.password))) {
      return null;
    }
    if ("mfa_enabled" in user && user.mfa_enabled) {
      return null;
    }
    return {
      id: user.id,
      role: user.role,
      emailVerifiedAt: user.email_verified_at ?? null,
    };
  },
};
