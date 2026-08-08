import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { RouteHandler } from "../../core/http/middleware";
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
      GET: controller.index,
      POST: kernel.wrapAbility(
        "organizations:create",
        controller.store as unknown as RouteHandler,
      ),
    },
    "/organizations/:id": {
      GET: controller.show,
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
      GET: kernel.wrapAuthenticated(
        memberController.index as unknown as RouteHandler,
      ),
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
