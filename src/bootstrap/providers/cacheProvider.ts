import type { CacheDriver } from "@getstrata/core/cache/createCacheStore";
import {
  createCacheStore,
  snapshotCacheStoreOptions,
} from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { CORE_CACHE_TOKEN } from "../config";
import type { ServiceProvider } from "../contracts";

function createCacheProvider(env: Readonly<Record<string, string | undefined>>): ServiceProvider {
  const options = snapshotCacheStoreOptions({
    driver: (env.CACHE_DRIVER ?? "array") as CacheDriver,
    ttlMs: Number(env.CACHE_TTL_MS ?? "3600000"),
    maxEntries: Number(env.CACHE_MAX_ENTRIES ?? "100"),
    redisUrl: env.REDIS_URL || undefined,
    namespace: `${env.APP_KEY_PREFIX?.trim() || "strata"}:cache:v3:`,
  });
  return Object.freeze({
    name: "core.cache",
    register({
      container,
      dependencies,
      onCleanup,
    }: Parameters<NonNullable<ServiceProvider["register"]>>[0]) {
      container.singleton(CORE_CACHE_TOKEN, () => {
        const cache = new CacheRepository(createCacheStore(options));
        onCleanup(() => cache.close());
        return cache;
      });
      dependencies.cache = container.resolve(CORE_CACHE_TOKEN);
    },
  });
}

export { createCacheProvider };
