import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import TaskController from "./controller";

function createTaskRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new TaskController(dependencies, cachedJson);

  return {
    "/tasks": {
      GET: kernel.wrapPublicRead(controller.index as unknown as RouteHandler),
      POST: kernel.wrapAbility("tasks:create", controller.store as unknown as RouteHandler),
    },
    "/tasks/:id": {
      GET: kernel.wrapPublicRead(controller.show as unknown as RouteHandler),
      PATCH: kernel.wrapAbility("tasks:update", controller.update as unknown as RouteHandler),
      DELETE: kernel.wrapAbility("tasks:delete", controller.destroy as unknown as RouteHandler),
    },
  };
}

export { createTaskRoutes };
