import { conditionalJsonResponse } from "@getstrata/core/http/conditionalResponse";
import type { AppDependencies, CachedJson } from "./contracts";

function createCachedJson(dependencies: Pick<AppDependencies, "cache">): CachedJson {
  return async <T>(
    cacheKey: string,
    loader: () => Promise<T>,
    tags: string[] = [],
    request?: Request,
  ): Promise<Response> => {
    const data =
      tags.length > 0
        ? await dependencies.cache.tags(...tags).remember(cacheKey, loader)
        : await dependencies.cache.remember(cacheKey, loader);

    return conditionalJsonResponse(request, data);
  };
}

export { createCachedJson };
