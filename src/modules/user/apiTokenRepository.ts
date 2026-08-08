import db from "../../db/connection";
import { BaseRepository } from "../../core/database";
import { apiTokenTable } from "./apiTokenTable";
import type { ApiTokenRecord } from "./types";

class ApiTokenRepository extends BaseRepository<ApiTokenRecord, "id"> {
  constructor() {
    super(apiTokenTable);
  }

  async findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    const records = await this.findAll({
      where: { token_hash: tokenHash },
      limit: 1,
    });

    return records[0] ?? null;
  }

  async touchLastUsedAt(id: number): Promise<void> {
    await db`
      UPDATE api_token
      SET last_used_at = NOW()
      WHERE id = ${id}
    `;
  }
}

export default ApiTokenRepository;
