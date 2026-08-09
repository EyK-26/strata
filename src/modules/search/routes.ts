import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import SearchController from "./controller";

function createSearchRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new SearchController(dependencies);

  return {
    "/search": kernel.wrapAuthenticated(controller.index as unknown as RouteHandler),
  };
}

export { createSearchRoutes };
