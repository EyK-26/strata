import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import WebhookController from "./controller";

function createWebhookRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new WebhookController(dependencies);

  return {
    "/webhooks": {
      GET: kernel.wrapAbility("webhooks:read", controller.index as unknown as RouteHandler),
      POST: kernel.wrapAbility("webhooks:write", controller.store as unknown as RouteHandler),
    },
  };
}

export { createWebhookRoutes };
