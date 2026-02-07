import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { buildRequestCacheKey, withErrorHandling } from "../../core/http";
import { toStatisticsResource } from "./resources";

class StatisticsController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  readonly index = withErrorHandling(async (request?: Request) => {
    return await this.cachedJson(
      buildRequestCacheKey("/statistics", request),
      async () => {
        return toStatisticsResource(
          await this.dependencies.statisticsService.getStatistics(),
        );
      },
    );
  });
}

export default StatisticsController;
