import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type OfferTemplateRecord, offerTemplateTable } from "./table.ts";

class OfferTemplateRepository extends TenantRepository<OfferTemplateRecord, "id"> {
  constructor() {
    super(offerTemplateTable);
  }

  async ordered() {
    return this.findAll({ orderBy: { column: "name", direction: "ASC" } });
  }
}

export const offerTemplates = new OfferTemplateRepository();
export type { OfferTemplateRecord };
