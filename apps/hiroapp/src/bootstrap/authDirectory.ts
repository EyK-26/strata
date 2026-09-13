import type { AuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import type {
  AuthUserDirectory,
  AuthUserRecord,
} from "@getstrata/core/contracts/authUserDirectory";
import { runWithMigrationBypassForIdentifier } from "@getstrata/core/tenant/databaseTenantContext";
import { ApiToken } from "../models/ApiToken.ts";
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
      | "session_valid_after"
      | "mfa_enabled"
      | "mfa_secret"
      | "mfa_recovery_codes",
  ): unknown;
};

function mapRole(isAdmin: unknown): string {
  return isAdmin === true || isAdmin === 1 || isAdmin === "1" ? "admin" : "member";
}

function asTimestamp(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === "string" ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapUserRow(user: LoadedUser): AuthUserRecord {
  return {
    id: Number(user.get("id")),
    name: String(user.get("name") ?? ""),
    email: String(user.get("email") ?? ""),
    role: mapRole(user.get("is_admin")),
    email_verified_at: asTimestamp(user.get("email_verified_at")),
    password: String(user.get("password") ?? ""),
    mfa_enabled: user.get("mfa_enabled") === true || user.get("mfa_enabled") === 1,
    mfa_secret: asNullableString(user.get("mfa_secret")),
    mfa_recovery_codes: asNullableString(user.get("mfa_recovery_codes")),
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
  async resolveUserFromToken(token: string) {
    if (!token || token.split(".").length === 3) {
      return null;
    }
    const hashed = hashApiToken(token);
    const tokenRow = await runWithMigrationBypassForIdentifier(hashed, async () => {
      return await ApiToken.where({ token_hash: hashed }).first();
    });
    if (!tokenRow) {
      return null;
    }
    const expiresAt = tokenRow.get("expires_at");
    if (expiresAt && new Date(String(expiresAt)).getTime() <= Date.now()) {
      return null;
    }
    const user_id = Number(tokenRow.get("user_id"));
    const user = await runWithMigrationBypassForIdentifier(user_id, async () => {
      return await User.find(user_id);
    });
    if (!user) {
      return null;
    }
    let abilities: string[] = [];
    try {
      abilities = JSON.parse(String(tokenRow.get("abilities") ?? "[]")) as string[];
    } catch {
      abilities = [];
    }
    return {
      id: user_id,
      role: mapRole(user.get("is_admin")),
      abilities,
      tokenId: Number(tokenRow.get("id")),
      emailVerifiedAt: asTimestamp(user.get("email_verified_at")),
    };
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
