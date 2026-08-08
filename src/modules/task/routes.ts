import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { RouteHandler } from "../../core/http/middleware";
import TaskController from "./controller";

function createTaskRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new TaskController(dependencies, cachedJson);

  return {
    "/tasks": {
      GET: controller.index,
      POST: controller.store,
    },
    "/tasks/:id": {
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

export { createTaskRoutes };
