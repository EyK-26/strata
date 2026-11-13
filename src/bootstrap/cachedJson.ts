import type { CacheLike } from "@getstrata/core/cache/tokens";
import { CORE_JSON_RESPONSE_POLICY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  conditionalJsonResponse,
  type JsonResponsePolicy,
  snapshotJsonResponsePolicy,
} from "@getstrata/core/http/conditionalResponse";
import type { AppDependencies, CachedJson } from "./contracts";

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

/** Standalone assembly defaults to ETags; owned applications bind a captured policy. */
function createApplicationCachedJson(
  dependencies: Pick<AppDependencies, "cache" | "container">,
): CachedJson {
  const policy = dependencies.container.has(CORE_JSON_RESPONSE_POLICY_TOKEN)
    ? dependencies.container.resolve(CORE_JSON_RESPONSE_POLICY_TOKEN)
    : { etagEnabled: true };
  return createCachedJson(dependencies.cache, policy);
}

export type { JsonResponsePolicy };
export { createApplicationCachedJson, createCachedJson };
