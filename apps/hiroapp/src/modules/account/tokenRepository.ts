import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type ApiTokenRecord, apiTokenTable } from "./tokenTable.ts";

class ApiTokenRepository extends BaseRepository<ApiTokenRecord, "id"> {
  constructor() {
    super(apiTokenTable);
  }

  async findByTokenHash(tokenHash: string) {
    return this.firstOrNull({ token_hash: tokenHash });
  }

  async forUser(userId: number) {
    return this.findWhere(
      { user_id: userId },
      { orderBy: { column: "created_at", direction: "DESC" } },
    );
  }
}

export const apiTokens = new ApiTokenRepository();
export type { ApiTokenRecord };
