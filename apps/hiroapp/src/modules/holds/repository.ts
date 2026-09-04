import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type ApplicationHoldRecord, applicationHoldTable } from "./table.ts";

class ApplicationHoldRepository extends TenantRepository<ApplicationHoldRecord, "id"> {
  constructor() {
    super(applicationHoldTable);
  }

  async forApplication(applicationId: number) {
    return this.firstOrNull({ application_id: applicationId });
  }
}

export const applicationHolds = new ApplicationHoldRepository();
export type { ApplicationHoldRecord };
