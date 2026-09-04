import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type OfferRecord, offerTable } from "./table.ts";

class OfferRepository extends TenantRepository<OfferRecord, "id"> {
  constructor() {
    super(offerTable);
  }

  async forApplication(applicationId: number) {
    return this.findWhere({ application_id: applicationId });
  }

  async activeForApplication(applicationId: number) {
    const rows = await this.forApplication(applicationId);
    return rows.find((row) => row.status === "draft" || row.status === "sent") ?? null;
  }
}

export const offers = new OfferRepository();
export type { OfferRecord };
