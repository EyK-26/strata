import type { CacheDriver } from "../../core/cache/createCacheStore";
import { createCacheStore } from "../../core/cache/createCacheStore";
import CacheRepository from "../../core/cache/repository";
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
  register({ container, config, dependencies }) {
    container.singleton(CORE_CACHE_TOKEN, () => {
      const store = createCacheStore({
        driver: config.require<CacheDriver>(CACHE_DRIVER_CONFIG_KEY),
        ttlMs: config.require<number>(CACHE_TTL_MS_CONFIG_KEY),
        maxEntries: config.require<number>(CACHE_MAX_ENTRIES_CONFIG_KEY),
        redisUrl: config.get<string>(REDIS_URL_CONFIG_KEY) || undefined,
      });

      return new CacheRepository(store);
    });

    dependencies.cache = container.resolve(CORE_CACHE_TOKEN);
  },
};

export default cacheProvider;
