import type { AppDependencies } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { RouteHandler } from "../../core/http/middleware";
import AdminController from "./controller";

function createAdminRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new AdminController(dependencies);

  return {
    "/admin/stats": {
      GET: kernel.wrapAbility("admin:read", controller.stats as unknown as RouteHandler),
    },
    "/admin/tenants": {
      GET: kernel.wrapAbility("admin:read", controller.tenants as unknown as RouteHandler),
    },
    "/admin/organization-members": {
      GET: kernel.wrapAbility(
        "admin:read",
        controller.organizationMembers as unknown as RouteHandler,
      ),
    },
    "/admin/features": {
      GET: kernel.wrapAbility("admin:read", controller.features as unknown as RouteHandler),
    },
  };
}

export { createAdminRoutes };
