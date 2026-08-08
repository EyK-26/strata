import { defineTable } from "../../core/database";
import type { ApiTokenRecord } from "./types";

const apiTokenTable = defineTable<ApiTokenRecord, "id">({
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
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { apiTokenTable };
