import type { AuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import type { AuthUserDirectory } from "@getstrata/core/contracts/authUserDirectory";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { getSql } from "./database.ts";

type UserRow = {
  id: number;
  name: string;
  email: string;
  is_admin: number | boolean;
  email_verified_at: Date | string | null;
  password: string;
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
    session_valid_after: row.session_valid_after ?? null,
  };
}

async function findUserById(id: number) {
  return await runWithMigrationBypass(async () => {
    const rows = await getSql().unsafe<UserRow>(
      "SELECT id, name, email, is_admin, email_verified_at, password, session_valid_after FROM users WHERE id = $1",
      [id],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`User ${id} not found.`);
    }
    return mapUserRow(row);
  });
}

async function findUserByEmail(email: string) {
  return await runWithMigrationBypass(async () => {
    const rows = await getSql().unsafe<UserRow>(
      "SELECT id, name, email, is_admin, email_verified_at, password, session_valid_after FROM users WHERE email = $1",
      [email.trim().toLowerCase()],
    );
    const row = rows[0];
    return row ? mapUserRow(row) : null;
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
