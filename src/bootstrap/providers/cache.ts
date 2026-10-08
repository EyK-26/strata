import type { CacheDriver } from "@getstrata/core/cache/createCacheStore";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import {
  CACHE_DRIVER_CONFIG_KEY,
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  CORE_CACHE_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "../config";
import type { ServiceProvider } from "../contracts";

const cacheProvider: ServiceProvider = {
  name: "core.cache",
  register({ container, config, dependencies, onCleanup }) {
    container.singleton(CORE_CACHE_TOKEN, () => {
      const store = createCacheStore({
        driver: config.require<CacheDriver>(CACHE_DRIVER_CONFIG_KEY),
        ttlMs: config.require<number>(CACHE_TTL_MS_CONFIG_KEY),
        maxEntries: config.require<number>(CACHE_MAX_ENTRIES_CONFIG_KEY),
        redisUrl: config.get<string>(REDIS_URL_CONFIG_KEY) || undefined,
      });

      const cache = new CacheRepository(store);
      onCleanup(() => cache.close());
      return cache;
    });

    dependencies.cache = container.resolve(CORE_CACHE_TOKEN);
  },
};

export default cacheProvider;
