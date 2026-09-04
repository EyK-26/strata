import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type SubscriptionRecord, subscriptionTable } from "./table.ts";

class SubscriptionRepository extends TenantRepository<SubscriptionRecord, "id"> {
  async forTenant(tenantId: number) {
    return this.firstOrNull({ tenant_id: tenantId });
  }
}

export const subscriptions = new SubscriptionRepository(subscriptionTable);
export type { SubscriptionRecord };
