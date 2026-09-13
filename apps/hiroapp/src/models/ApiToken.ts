import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface ApiTokenRecord {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  abilities: string;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  created_at: Date | string;
}

const apiTokensTable = defineTable<ApiTokenRecord, "id">({
  name: "api_tokens",
  primaryKey: "id",
  columns: [
    "id",
    "user_id",
    "name",
    "token_hash",
    "abilities",
    "expires_at",
    "last_used_at",
    "created_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class ApiTokenRepository extends BaseRepository<ApiTokenRecord, "id"> {
  constructor() {
    super(apiTokensTable);
  }
}

class ApiToken extends Model<ApiTokenRecord, "id"> {
  static $fillable = [
    "user_id",
    "name",
    "token_hash",
    "abilities",
    "expires_at",
    "last_used_at",
  ] as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

registerModelRepository(ApiToken, new ApiTokenRepository());

export type { ApiTokenRecord };
export { ApiToken };
