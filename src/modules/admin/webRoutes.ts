import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import AdminWebController from "./webController";

function createAdminWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new AdminWebController(dependencies);

  return {
    "/admin": {
      GET: kernel.wrapWebGlobalAdmin(controller.dashboard as unknown as RouteHandler),
    },
    "/admin/queue": {
      GET: kernel.wrapWebGlobalAdmin(controller.queue as unknown as RouteHandler),
    },
    "/admin/queue/failed/:id/retry": {
      POST: kernel.wrapWebGlobalAdmin(controller.retryFailedJob as unknown as RouteHandler),
    },
    "/admin/queue/failed/:id/delete": {
      POST: kernel.wrapWebGlobalAdmin(controller.deleteFailedJob as unknown as RouteHandler),
    },
    "/admin/queue/status": {
      GET: kernel.wrapWebGlobalAdmin(controller.queueStatus as unknown as RouteHandler),
    },
    "/admin/audit": {
      GET: kernel.wrapWebGlobalAdmin(controller.audit as unknown as RouteHandler),
    },
    "/admin/resources": {
      GET: kernel.wrapWebGlobalAdmin(controller.resources as unknown as RouteHandler),
    },
    "/admin/resources/:name": {
      GET: kernel.wrapWebGlobalAdmin(controller.resourceIndex as unknown as RouteHandler),
    },
    "/admin/resources/:name/:id": {
      GET: kernel.wrapWebGlobalAdmin(controller.resourceShow as unknown as RouteHandler),
    },
  };
}

export { createAdminWebRoutes };
