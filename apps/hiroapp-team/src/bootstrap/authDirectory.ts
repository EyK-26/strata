import type { AuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import type { AuthUserDirectory } from "@getstrata/core/contracts/authUserDirectory";
import { getSql } from "./database.ts";

function mapRole(isAdmin: unknown): string {
  return isAdmin === true || isAdmin === 1 || isAdmin === "1" ? "admin" : "member";
}

export const starterAuthDirectory: AuthUserDirectory = {
  async resolveUserFromToken() {
    return null;
  },

  async findByIdOrThrow(id: number) {
    const rows = await getSql().unsafe<
      Array<{
        id: number;
        name: string;
        email: string;
        is_admin: number | boolean;
        email_verified_at: Date | string | null;
        password: string;
        mfa_enabled?: number | boolean;
        mfa_secret?: string | null;
        mfa_recovery_codes?: string | null;
      }>
    >(`SELECT id, name, email, is_admin, email_verified_at, password FROM users WHERE id = $1`, [
      id,
    ]);
    const row = rows[0];
    if (!row) {
      throw new Error(`User ${id} not found.`);
    }
    return {
      id: Number(row.id),
      name: row.name,
      email: row.email,
      role: mapRole(row.is_admin),
      email_verified_at: row.email_verified_at ?? null,
      password: row.password,
    };
  },

  async findByEmail(email: string) {
    const rows = await getSql().unsafe<
      Array<{
        id: number;
        name: string;
        email: string;
        is_admin: number | boolean;
        email_verified_at: Date | string | null;
        password: string;
        mfa_enabled?: number | boolean;
        mfa_secret?: string | null;
        mfa_recovery_codes?: string | null;
      }>
    >(`SELECT id, name, email, is_admin, email_verified_at, password FROM users WHERE email = $1`, [
      email.trim().toLowerCase(),
    ]);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: Number(row.id),
      name: row.name,
      email: row.email,
      role: mapRole(row.is_admin),
      email_verified_at: row.email_verified_at ?? null,
      password: row.password,
    };
  },

  async verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
    const user = await this.findByEmail(email);
    if (!user?.password || !(await verifyPassword(password, user.password))) {
      return null;
    }
    return {
      id: user.id,
      role: user.role,
      emailVerifiedAt: user.email_verified_at ?? null,
    };
  },
};
