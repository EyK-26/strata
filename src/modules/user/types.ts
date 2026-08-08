import type { UserRole } from "../../domain/auth";

interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

interface ApiTokenRecord {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  last_used_at: Date | null;
  created_at: Date;
}

export type { ApiTokenRecord, UserRecord };
