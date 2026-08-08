import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
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
      POST: kernel.wrapAbility("tasks:create", controller.store as unknown as RouteHandler),
    },
    "/tasks/:id": {
      GET: controller.show,
      PATCH: kernel.wrapAbility("tasks:update", controller.update as unknown as RouteHandler),
      DELETE: kernel.wrapAbility("tasks:delete", controller.destroy as unknown as RouteHandler),
    },
  };
}

export { createTaskRoutes };
