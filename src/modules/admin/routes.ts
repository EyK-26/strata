import type { AppDependencies } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { RouteHandler } from "../../core/http/middleware";
import AdminController from "./controller";

function createAdminRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new AdminController(dependencies);

  return {
    "/admin/stats": {
      GET: kernel.wrapGlobalAdmin(controller.stats as unknown as RouteHandler),
    },
    "/admin/tenants": {
      GET: kernel.wrapGlobalAdmin(controller.tenants as unknown as RouteHandler),
    },
    "/admin/organization-members": {
      GET: kernel.wrapGlobalAdmin(controller.organizationMembers as unknown as RouteHandler),
    },
    "/admin/features": {
      GET: kernel.wrapGlobalAdmin(controller.features as unknown as RouteHandler),
    },
  };
}

export { createAdminRoutes };
