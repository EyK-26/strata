import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { buildRequestCacheKey, withErrorHandling } from "../../core/http";
import { toJSONTreeResource } from "./resources";

class TreeController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  readonly show = withErrorHandling(async (request?: Request) => {
    return await this.cachedJson(
      buildRequestCacheKey("/final-json-tree", request),
      async () => {
        return toJSONTreeResource(
          await this.dependencies.jsonTreeService.buildJSONTree(),
        );
      },
    );
  });
}

export default TreeController;
