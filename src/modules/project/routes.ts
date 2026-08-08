import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { RouteHandler } from "../../core/http/middleware";
import ProjectController from "./controller";

function createProjectRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new ProjectController(dependencies, cachedJson);

  return {
    "/projects": {
      GET: controller.index,
      POST: kernel.wrapAbility(
        "projects:create",
        controller.store as unknown as RouteHandler,
      ),
    },
    "/projects/:id": {
      GET: controller.show,
      PATCH: kernel.wrapAbility(
        "projects:update",
        controller.update as unknown as RouteHandler,
      ),
      DELETE: kernel.wrapAbility(
        "projects:delete",
        controller.destroy as unknown as RouteHandler,
      ),
    },
  };
}

export { createProjectRoutes };
