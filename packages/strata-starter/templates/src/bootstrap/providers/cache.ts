import { CORE_CACHE_TOKEN } from "@getstrata/bootstrap/config";
import type { AppDependencies, ServiceProvider } from "@getstrata/bootstrap/contracts";
/** Adapt the already graph-owned cache; this provider never creates or closes it. */
export function createCacheProvider(cache: AppDependencies["cache"]): ServiceProvider {
  return {
    name: "starter.cache",
    register({ container, dependencies }) {
      container.set(CORE_CACHE_TOKEN, cache);
      dependencies.cache = cache;
    },
  };
}
