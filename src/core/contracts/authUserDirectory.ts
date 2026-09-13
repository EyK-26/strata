import type { AuthUser } from "../auth/authContext";

interface AuthUserRecord {
  id: number;
  name?: string | null;
  email?: string | null;
  role: string;
  email_verified_at?: Date | string | null;
  session_valid_after?: Date | string | null;
  password?: string | null;
  mfa_enabled?: boolean;
  mfa_secret?: string | null;
  mfa_recovery_codes?: string | null;
}

interface AuthUserDirectory {
  resolveUserFromToken(token: string): Promise<AuthUser | null>;
  findByIdOrThrow(id: number): Promise<AuthUserRecord>;
  hasActiveBrowserSession?(userId: number, issuedAt: number): Promise<boolean>;
  findByEmail?(email: string): Promise<AuthUserRecord | null>;
  verifyCredentials?(email: string, password: string): Promise<AuthUser | null>;
}

export type { AuthUserDirectory, AuthUserRecord };
