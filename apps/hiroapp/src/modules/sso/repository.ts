import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { runWithoutTenantScope, TenantRepository } from "../../lib/tenantRepository.ts";
import { type OauthIdentityRecord, oauthIdentityTable } from "./table.ts";

class OauthIdentityRepository extends TenantRepository<OauthIdentityRecord, "id"> {
  constructor() {
    super(oauthIdentityTable);
  }

  async findByProvider(provider: string, providerUserId: string) {
    return runWithoutTenantScope(() =>
      runWithMigrationBypass(() =>
        this.firstOrNull({ provider, provider_user_id: providerUserId }),
      ),
    );
  }
}

export const oauthIdentities = new OauthIdentityRepository();
export type { OauthIdentityRecord };
