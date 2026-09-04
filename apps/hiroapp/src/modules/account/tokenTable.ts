import { defineTable } from "@getstrata/core/database/table";

export interface ApiTokenRecord {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  abilities: string[] | string;
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
}

export const apiTokenTable = defineTable<ApiTokenRecord, "id">({
  name: "api_token",
  primaryKey: "id",
  columns: [
    "id",
    "user_id",
    "name",
    "token_hash",
    "abilities",
    "last_used_at",
    "expires_at",
    "created_at",
  ],
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});
