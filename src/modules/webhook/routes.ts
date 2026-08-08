import type { AppDependencies } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { RouteHandler } from "../../core/http/middleware";
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
