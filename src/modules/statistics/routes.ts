import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import StatisticsController from "./controller";

function createStatisticsRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
) {
  const controller = new StatisticsController(dependencies, cachedJson);

  return {
    "/statistics": controller.index,
  };
}

export { createStatisticsRoutes };
