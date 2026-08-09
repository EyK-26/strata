import type { AppDependencies, CachedJson } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import CommentController from "./controller";

function createCommentRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new CommentController(dependencies, cachedJson);

  return {
    "/comments": kernel.wrapPublicRead(controller.index as unknown as RouteHandler),
    "/comments/:id": {
      GET: kernel.wrapPublicRead(controller.show as unknown as RouteHandler),
      PATCH: kernel.wrapAbility("comments:update", controller.update as unknown as RouteHandler),
      DELETE: kernel.wrapAbility("comments:delete", controller.destroy as unknown as RouteHandler),
    },
    "/tasks/:id/comments": {
      GET: kernel.wrapPublicRead(controller.byTask as unknown as RouteHandler),
      POST: kernel.wrapAbility(
        "comments:create",
        controller.storeForTask as unknown as RouteHandler,
      ),
    },
  };
}

export { createCommentRoutes };
