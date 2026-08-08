import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { RouteHandler } from "../../core/http/middleware";
import CommentController from "./controller";

function createCommentRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new CommentController(dependencies, cachedJson);

  return {
    "/comments": controller.index,
    "/comments/:id": {
      GET: controller.show,
      PATCH: kernel.wrapAbility("comments:update", controller.update as unknown as RouteHandler),
      DELETE: kernel.wrapAbility("comments:delete", controller.destroy as unknown as RouteHandler),
    },
    "/tasks/:id/comments": {
      GET: controller.byTask,
      POST: kernel.wrapAbility(
        "comments:create",
        controller.storeForTask as unknown as RouteHandler,
      ),
    },
  };
}

export { createCommentRoutes };
