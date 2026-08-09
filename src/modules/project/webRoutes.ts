import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import ProjectWebController from "./webController";

function createProjectWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new ProjectWebController(dependencies);

  return {
    "/projects": {
      GET: kernel.wrapWebPublicRead(controller.index as unknown as RouteHandler),
      POST: kernel.wrapWebAbility("projects:create", controller.store as unknown as RouteHandler),
    },
    "/projects/:id": {
      GET: kernel.wrapWebPublicRead(controller.show as unknown as RouteHandler),
      PATCH: kernel.wrapWebAbility("projects:update", controller.update as unknown as RouteHandler),
      DELETE: kernel.wrapWebAbility(
        "projects:delete",
        controller.destroy as unknown as RouteHandler,
      ),
    },
  };
}

export { createProjectWebRoutes };
