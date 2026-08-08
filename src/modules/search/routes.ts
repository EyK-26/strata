import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies } from "../../bootstrap/contracts";
import SearchController from "./controller";

function createSearchRoutes(dependencies: AppDependencies, _kernel: HttpKernel) {
  const controller = new SearchController(dependencies);

  return {
    "/search": controller.index,
  };
}

export { createSearchRoutes };
