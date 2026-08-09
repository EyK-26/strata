import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
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
