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
      POST: controller.store,
    },
    "/projects/:id": {
      GET: controller.show,
      PATCH: kernel.wrapAuthenticated(
        controller.update as unknown as RouteHandler,
      ),
      DELETE: kernel.wrapAuthenticated(
        controller.destroy as unknown as RouteHandler,
      ),
    },
  };
}

export { createProjectRoutes };
