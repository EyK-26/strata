import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import TaskWebController from "./webController";

function createTaskWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new TaskWebController(dependencies);

  return {
    "/tasks": {
      GET: kernel.wrapWebPublicRead(controller.index as unknown as RouteHandler),
      POST: kernel.wrapWebAbility("tasks:create", controller.store as unknown as RouteHandler),
    },
    "/tasks/:id": {
      GET: kernel.wrapWebPublicRead(controller.show as unknown as RouteHandler),
      PATCH: kernel.wrapWebAbility("tasks:update", controller.update as unknown as RouteHandler),
      DELETE: kernel.wrapWebAbility("tasks:delete", controller.destroy as unknown as RouteHandler),
    },
  };
}

export { createTaskWebRoutes };
