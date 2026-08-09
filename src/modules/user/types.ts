import type { UserRole } from "../../domain/auth";

interface UserRecord {
  id: number;
  name: string;
  email: string;
  email_lookup?: string | null;
  role: UserRole;
  tenant_id: number;
  password_hash?: string | null;
  email_verified_at?: Date | null;
  mfa_secret?: string | null;
  mfa_enabled?: boolean;
  created_at: Date;
  updated_at: Date;
}

interface OAuthIdentityRecord {
  id: number;
  user_id: number;
  provider: string;
  provider_user_id: string;
  email: string | null;
  created_at: Date;
}

interface ApiTokenRecord {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  abilities: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

interface ApiTokenResource {
  id: number;
  name: string;
  abilities: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface CreatedApiToken {
  token: ApiTokenResource;
  plainTextToken: string;
}

export type { ApiTokenRecord, ApiTokenResource, CreatedApiToken, OAuthIdentityRecord, UserRecord };
