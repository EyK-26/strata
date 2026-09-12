import type { AuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import type { AuthUserDirectory } from "@getstrata/core/contracts/authUserDirectory";
import { getSql } from "./database.ts";

type UserRow = {
  id: number;
  name: string;
  email: string;
  is_admin: number | boolean;
  email_verified_at: Date | string | null;
  password: string;
  mfa_enabled?: number | boolean;
  mfa_secret?: string | null;
  mfa_recovery_codes?: string | null;
  session_valid_after?: Date | string | null;
};

function mapRole(isAdmin: unknown): string {
  return isAdmin === true || isAdmin === 1 || isAdmin === "1" ? "admin" : "member";
}

function mapUserRow(row: UserRow) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: mapRole(row.is_admin),
    email_verified_at: row.email_verified_at ?? null,
    password: row.password,
    mfa_enabled: row.mfa_enabled === true || row.mfa_enabled === 1,
    mfa_secret: row.mfa_secret ?? null,
    mfa_recovery_codes: row.mfa_recovery_codes ?? null,
    session_valid_after: row.session_valid_after ?? null,
  };
}

async function findUserById(id: number) {
  const rows = await getSql().unsafe<UserRow>(
    "SELECT id, name, email, is_admin, email_verified_at, password, mfa_enabled, mfa_secret, mfa_recovery_codes, session_valid_after FROM users WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`User ${id} not found.`);
  }
  return mapUserRow(row);
}

async function findUserByEmail(email: string) {
  const rows = await getSql().unsafe<UserRow>(
    "SELECT id, name, email, is_admin, email_verified_at, password, mfa_enabled, mfa_secret, mfa_recovery_codes, session_valid_after FROM users WHERE email = $1",
    [email.trim().toLowerCase()],
  );
  const row = rows[0];
  return row ? mapUserRow(row) : null;
}

export const starterAuthDirectory: AuthUserDirectory = {
  async resolveUserFromToken(token: string) {
    if (!token || token.split(".").length === 3) {
      return null;
    }
    const hashed = hashApiToken(token);
    const rows = await getSql().unsafe<{
      id: number;
      user_id: number;
      abilities: string;
      expires_at: Date | string | null;
      role?: string;
      is_admin?: number | boolean;
      email_verified_at?: Date | string | null;
    }>(
      `SELECT t.id, t.user_id, t.abilities, t.expires_at, u.is_admin, u.email_verified_at
       FROM api_tokens t INNER JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1`,
      [hashed],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      return null;
    }
    let abilities: string[] = [];
    try {
      abilities = JSON.parse(String(row.abilities ?? "[]")) as string[];
    } catch {
      abilities = ["profile:read"];
    }
    return {
      id: Number(row.user_id),
      role: row.is_admin ? "admin" : "member",
      abilities,
      tokenId: Number(row.id),
      emailVerifiedAt: row.email_verified_at ?? null,
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
