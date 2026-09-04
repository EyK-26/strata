import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type ApiTokenRecord, apiTokenTable } from "./tokenTable.ts";

class ApiTokenRepository extends TenantRepository<ApiTokenRecord, "id"> {
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
