import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
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
      DELETE: kernel.wrapAuthenticated(
        controller.destroy as unknown as RouteHandler,
      ),
    },
    "/tasks/:id/comments": {
      GET: controller.byTask,
      POST: controller.storeForTask,
    },
  };
}

export { createCommentRoutes };
