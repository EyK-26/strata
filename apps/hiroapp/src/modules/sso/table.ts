import { defineTable } from "@getstrata/core/database/table";

export interface OauthIdentityRecord {
  id: number;
  user_id: number;
  provider: string;
  provider_user_id: string;
  email: string | null;
  tenant_id?: number | null;
  created_at: Date;
}

export const oauthIdentityTable = defineTable<OauthIdentityRecord, "id">({
  name: "oauth_identity",
  primaryKey: "id",
  columns: ["id", "user_id", "provider", "provider_user_id", "email", "tenant_id", "created_at"],
});
