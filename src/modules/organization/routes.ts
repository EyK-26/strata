import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { RouteHandler } from "../../core/http/middleware";
import OrganizationController from "./controller";

function createOrganizationRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new OrganizationController(dependencies, cachedJson);

  return {
    "/organizations": {
      GET: controller.index,
      POST: controller.store,
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
  };
}

export { createOrganizationRoutes };
