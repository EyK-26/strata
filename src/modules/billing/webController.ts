import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import { billingServiceToken } from "./provider";
import type BillingService from "./service";

class BillingWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): BillingService {
    return resolveService(this.dependencies, billingServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  readonly show = withErrorHandling(async () => {
    const subscription = await this.service.getSubscriptionForTenant(currentTenantId());

    return htmlResponse(
      await this.view.render("billing/show", {
        title: "Billing",
        subscription,
      }),
    );
  });
}

function createBillingWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new BillingWebController(dependencies);

  return {
    "/billing": {
      GET: kernel.wrapWebAuthenticated(controller.show as unknown as RouteHandler),
    },
  };
}

export default BillingWebController;
export { createBillingWebRoutes };
