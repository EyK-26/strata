import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface AuthOneTimeTokenRecord {
  id: number;
  purpose: string;
  user_id: number;
  token_hash: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

const authOneTimeTokensTable = defineTable<AuthOneTimeTokenRecord, "id">({
  name: "auth_one_time_tokens",
  primaryKey: "id",
  columns: ["id", "purpose", "user_id", "token_hash", "expires_at", "consumed_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class AuthOneTimeTokenRepository extends BaseRepository<AuthOneTimeTokenRecord, "id"> {
  constructor() {
    super(authOneTimeTokensTable);
  }
}

class AuthOneTimeToken extends Model<AuthOneTimeTokenRecord, "id"> {
  static $fillable = ["purpose", "user_id", "token_hash", "expires_at", "consumed_at"] as const;
  static $timestamps = false;
}

registerModelRepository(AuthOneTimeToken, new AuthOneTimeTokenRepository());

export type { AuthOneTimeTokenRecord };
export { AuthOneTimeToken };
