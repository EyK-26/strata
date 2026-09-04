import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { CORE_CACHE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { LocalStorageDriver, StorageManager } from "@getstrata/core/storage/storage";

export const cacheProvider: ServiceProvider = {
  name: "hiroapp.cache",
  register({ container, config, dependencies }) {
    const cache = new CacheRepository(
      createCacheStore({
        driver: (config.get("cache.driver") as "array" | "redis") ?? "array",
        ttlMs: Number(config.get("cache.ttlMs") ?? 3_600_000),
        maxEntries: Number(config.get("cache.maxEntries") ?? 100),
        redisUrl: config.get("cache.redisUrl") || undefined,
      }),
    );
    container.set(CORE_CACHE_TOKEN, cache);
    dependencies.cache = cache;
    dependencies.storage = new StorageManager(new LocalStorageDriver("./storage"));
  },
};
