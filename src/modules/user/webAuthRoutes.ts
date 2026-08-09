import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import WebAuthController from "./webAuthController";

function createWebAuthRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new WebAuthController(dependencies);

  return {
    "/login": {
      GET: kernel.wrapWeb(controller.showLogin as unknown as RouteHandler),
      POST: kernel.wrapWeb(kernel.wrapLogin(controller.login as unknown as RouteHandler)),
    },
    "/logout": {
      POST: kernel.wrapWebAuthenticated(controller.logout as unknown as RouteHandler),
    },
  };
}

export { createWebAuthRoutes };
