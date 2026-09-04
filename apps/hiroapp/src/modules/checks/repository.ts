import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type BackgroundCheckRecord, backgroundCheckTable } from "./table.ts";

class BackgroundCheckRepository extends TenantRepository<BackgroundCheckRecord, "id"> {
  constructor() {
    super(backgroundCheckTable);
  }

  async forApplication(applicationId: number) {
    return this.firstOrNull({ application_id: applicationId });
  }
}

export const backgroundChecks = new BackgroundCheckRepository();
export type { BackgroundCheckRecord };
