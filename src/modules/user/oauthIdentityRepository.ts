import { BaseRepository, defineTable } from "@getstrata/core/database";
import type { QueryWhere } from "@getstrata/core/database/types";
import type { OAuthIdentityRecord } from "./types";

const oauthIdentityTable = defineTable<OAuthIdentityRecord, "id">({
  name: "oauth_identity",
  primaryKey: "id",
  columns: ["id", "user_id", "provider", "provider_user_id", "email", "created_at"],
});

class OAuthIdentityRepository extends BaseRepository<OAuthIdentityRecord, "id"> {
  constructor() {
    super(oauthIdentityTable);
  }

  async findByProviderUser(
    provider: string,
    providerUserId: string,
  ): Promise<OAuthIdentityRecord | null> {
    const records = await this.findWhere(
      {
        provider,
        provider_user_id: providerUserId,
      } as unknown as QueryWhere<OAuthIdentityRecord>,
      { limit: 1 },
    );

    return records[0] ?? null;
  }
}

export default OAuthIdentityRepository;
export { oauthIdentityTable };
