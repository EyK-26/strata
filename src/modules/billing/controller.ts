import type { AppDependencies } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import { jsonResponse, withErrorHandling } from "../../core/http";
import { currentTenantId } from "../../core/tenant/tenantContext";
import { billingServiceToken } from "./provider";
import type BillingService from "./service";

class BillingController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): BillingService {
    return resolveService(this.dependencies, billingServiceToken);
  }

  readonly showSubscription = withErrorHandling(async () => {
    const subscription = await this.service.getSubscriptionForTenant(currentTenantId());

    return jsonResponse({
      tenant_id: currentTenantId(),
      subscription,
    });
  });

  readonly stripeWebhook = withErrorHandling(async (request: Request) => {
    const payload = (await request.json()) as {
      type?: string;
      data?: { object?: { metadata?: { tenant_id?: string }; status?: string } };
    };

    if (payload.type === "customer.subscription.updated") {
      const tenantId = Number.parseInt(payload.data?.object?.metadata?.tenant_id ?? "", 10);
      const status = payload.data?.object?.status;

      if (Number.isInteger(tenantId) && tenantId > 0) {
        await this.service.upsertSubscription({
          tenantId,
          plan: "pro",
          status:
            status === "active" || status === "trialing" || status === "past_due"
              ? status
              : "canceled",
        });
      }
    }

    return jsonResponse({ received: true });
  });
}

export default BillingController;
