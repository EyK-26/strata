import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import BillingController from "./controller";

function createBillingRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new BillingController(dependencies);

  return {
    "/billing/subscription": {
      GET: kernel.wrapAuthenticated(controller.showSubscription as unknown as RouteHandler),
    },
    "/billing/webhooks/stripe": {
      POST: controller.stripeWebhook,
    },
  };
}

export { createBillingRoutes };
