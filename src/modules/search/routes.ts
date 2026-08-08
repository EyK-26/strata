import type { AppDependencies } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { RouteHandler } from "../../core/http/middleware";
import SearchController from "./controller";

function createSearchRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new SearchController(dependencies);

  return {
    "/search": kernel.wrapAuthenticated(controller.index as unknown as RouteHandler),
  };
}

export { createSearchRoutes };
