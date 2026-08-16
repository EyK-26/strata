import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import OrganizationController from "./controller";
import OrganizationMemberController from "./memberController";

function createOrganizationRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new OrganizationController(dependencies, cachedJson);
  const memberController = new OrganizationMemberController(dependencies);

  return {
    "/organizations": {
      GET: kernel.wrapPublicRead(controller.index as unknown as RouteHandler),
      POST: kernel.wrapAbility("organizations:create", controller.store as unknown as RouteHandler),
    },
    "/organizations/:id": {
      GET: kernel.wrapPublicRead(controller.show as unknown as RouteHandler),
      PATCH: kernel.wrapAbility(
        "organizations:update",
        controller.update as unknown as RouteHandler,
      ),
      DELETE: kernel.wrapAbility(
        "organizations:delete",
        controller.destroy as unknown as RouteHandler,
      ),
    },
    "/organizations/:id/members": {
      GET: kernel.wrapAuthenticated(memberController.index as unknown as RouteHandler),
      POST: kernel.wrapAbility(
        "organizations:members:write",
        memberController.store as unknown as RouteHandler,
      ),
    },
    "/organizations/:id/members/:userId": {
      DELETE: kernel.wrapAbility(
        "organizations:members:delete",
        memberController.destroy as unknown as RouteHandler,
      ),
    },
  };
}

export { createOrganizationRoutes };
