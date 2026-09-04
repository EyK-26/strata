import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type OnboardingItemRecord, onboardingItemTable } from "./table.ts";

class OnboardingRepository extends TenantRepository<OnboardingItemRecord, "id"> {
  constructor() {
    super(onboardingItemTable);
  }

  async forApplication(applicationId: number) {
    return this.findWhere(
      { application_id: applicationId },
      { orderBy: { column: "id", direction: "ASC" } },
    );
  }
}

export const onboardingItems = new OnboardingRepository();
export type { OnboardingItemRecord };
