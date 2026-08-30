import type { AuthUser } from "../auth/authContext";

interface AuthUserRecord {
  id: number;
  email?: string | null;
  role: string;
  email_verified_at?: Date | string | null;
  session_valid_after?: Date | string | null;
}

interface AuthUserDirectory {
  resolveUserFromToken(token: string): Promise<AuthUser | null>;
  findByIdOrThrow(id: number): Promise<AuthUserRecord>;
}

export type { AuthUserDirectory, AuthUserRecord };
