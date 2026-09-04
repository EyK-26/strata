import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type TalentPoolEntryRecord, talentPoolTable } from "./table.ts";

class TalentPoolRepository extends TenantRepository<TalentPoolEntryRecord, "id"> {
  constructor() {
    super(talentPoolTable);
  }

  async findByUser(userId: number) {
    return this.firstOrNull({ user_id: userId });
  }
}

export const talentPool = new TalentPoolRepository();
export type { TalentPoolEntryRecord };
