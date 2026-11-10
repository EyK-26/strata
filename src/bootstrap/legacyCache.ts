/** Temporary old composition bridge; remove with M4/M5 route/provider migration. */

import type { CacheDriver } from "@getstrata/core/cache/createCacheStore";
import {
  createCacheStore,
  snapshotCacheStoreOptions,
} from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { createCachedJson } from "./cachedJson";
import {
  CACHE_DRIVER_CONFIG_KEY,
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  CORE_CACHE_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "./config";
import type { AppDependencies, CachedJson, ServiceProvider } from "./contracts";

const legacyCacheProvider: ServiceProvider = {
  name: "core.cache",
  register({ container, config, dependencies, onCleanup }) {
    const options = snapshotCacheStoreOptions({
      driver: config.require<CacheDriver>(CACHE_DRIVER_CONFIG_KEY),
      ttlMs: config.require<number>(CACHE_TTL_MS_CONFIG_KEY),
      maxEntries: config.require<number>(CACHE_MAX_ENTRIES_CONFIG_KEY),
      redisUrl: config.get<string>(REDIS_URL_CONFIG_KEY) || undefined,
      namespace: `${process.env.APP_KEY_PREFIX?.trim() || "strata"}:cache:v3:`,
    });
    container.singleton(CORE_CACHE_TOKEN, () => {
      const cache = new CacheRepository(createCacheStore(options));
      onCleanup(() => cache.close());
      return cache;
    });
    dependencies.cache = container.resolve(CORE_CACHE_TOKEN);
  },
};

function createLegacyCachedJson(dependencies: Pick<AppDependencies, "cache">): CachedJson {
  return createCachedJson(
    dependencies.cache,
    Object.freeze({ etagEnabled: (process.env.FEATURE_ETAG ?? "true") !== "false" }),
  );
}

export { createLegacyCachedJson, legacyCacheProvider };
