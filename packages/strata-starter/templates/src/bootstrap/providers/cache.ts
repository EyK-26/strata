import { CORE_CACHE_TOKEN } from "@getstrata/bootstrap/config";
import { CacheRepository } from "@getstrata/core";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import type { ServiceProvider } from "@getstrata/core/contracts/di";

const cacheProvider: ServiceProvider = {
  name: "starter.cache",
  register({ container, config, dependencies }) {
    container.singleton(CORE_CACHE_TOKEN, () => {
      const ttlMs = config.get<number>("cache.ttlMs") ?? 3_600_000;
      const maxEntries = config.get<number>("cache.maxEntries") ?? 100;
      const driver = config.get<"array" | "redis">("cache.driver") ?? "array";

      return new CacheRepository(
        createCacheStore({
          driver,
          ttlMs,
          maxEntries,
          redisUrl: process.env.REDIS_URL,
        }),
      );
    });

    Reflect.set(dependencies, "cache", container.resolve(CORE_CACHE_TOKEN));
  },
};

export default cacheProvider;
