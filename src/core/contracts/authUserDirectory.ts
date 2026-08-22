import type { AuthUser } from "../auth/authContext";

interface AuthUserRecord {
  id: number;
  email?: string | null;
  role: string;
}

interface AuthUserDirectory {
  resolveUserFromToken(token: string): Promise<AuthUser | null>;
  findByIdOrThrow(id: number): Promise<AuthUserRecord>;
}

export type { AuthUserDirectory, AuthUserRecord };
