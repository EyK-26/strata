import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import TreeController from "./controller";

function createTreeRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
) {
  const controller = new TreeController(dependencies, cachedJson);

  return {
    "/final-json-tree": controller.show,
  };
}

export { createTreeRoutes };
