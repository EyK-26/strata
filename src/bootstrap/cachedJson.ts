import type { CacheLike } from "@getstrata/core/cache/tokens";
import {
  conditionalJsonResponse,
  type JsonResponsePolicy,
  snapshotJsonResponsePolicy,
} from "@getstrata/core/http/conditionalResponse";
import type { CachedJson } from "./contracts";

function createCachedJson(cache: CacheLike, policy: JsonResponsePolicy): CachedJson {
  const responsePolicy = snapshotJsonResponsePolicy(policy);
  return async <T>(
    cacheKey: string,
    loader: () => Promise<T>,
    tags: string[] = [],
    request?: Request,
  ): Promise<Response> => {
    const data =
      tags.length > 0
        ? await cache.tags(...tags).remember(cacheKey, loader)
        : await cache.remember(cacheKey, loader);

    return conditionalJsonResponse(request, data, responsePolicy);
  };
}

export type { JsonResponsePolicy };
export { createCachedJson };
