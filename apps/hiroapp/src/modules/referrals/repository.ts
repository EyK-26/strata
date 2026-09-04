import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type ReferralRecord, referralTable } from "./table.ts";

class ReferralRepository extends TenantRepository<ReferralRecord, "id"> {
  constructor() {
    super(referralTable);
  }

  async forPosition(positionId: number) {
    return this.findWhere({ position_id: positionId });
  }

  async forReferrer(userId: number) {
    return this.findWhere({ referred_by: userId });
  }

  async openForEmail(email: string, positionId: number) {
    return this.firstOrNull({ email, position_id: positionId, status: "open" });
  }
}

export const referrals = new ReferralRepository();
export type { ReferralRecord };
