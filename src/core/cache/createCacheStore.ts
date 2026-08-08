import RedisCacheStore from "./redisCacheStore";
import SimpleCache from "./simpleCache";
import SimpleCacheStore from "./simpleCacheStore";
import type { CacheStore } from "./store";

type CacheDriver = "array" | "redis";

interface CreateCacheStoreOptions {
  driver: CacheDriver;
  ttlMs: number;
  maxEntries: number;
  redisUrl?: string;
}

function createCacheStore(options: CreateCacheStoreOptions): CacheStore {
  if (options.driver === "redis") {
    if (!options.redisUrl) {
      throw new Error('CACHE_DRIVER="redis" requires REDIS_URL to be set.');
    }

    return new RedisCacheStore(options.redisUrl, options.ttlMs, options.maxEntries);
  }

  return new SimpleCacheStore(new SimpleCache(options.ttlMs, options.maxEntries));
}

export type { CacheDriver, CreateCacheStoreOptions };
export { createCacheStore };
