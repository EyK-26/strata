import { copyApplicationConfig } from "../config/configSnapshot";
import RedisCacheStore, {
  DEFAULT_CACHE_NAMESPACE,
  normalizeRedisCacheOptions,
  type RedisCacheOptions,
  validateCacheNamespace,
} from "./redisCacheStore";
import SimpleCache, { validateSimpleCacheOptions } from "./simpleCache";
import SimpleCacheStore from "./simpleCacheStore";
import type { CacheStore } from "./store";

type CacheDriver = "array" | "redis";

interface CreateCacheStoreOptions {
  driver: CacheDriver;
  ttlMs: number;
  maxEntries: number;
  redisUrl?: string;
  redis?: Readonly<RedisCacheOptions>;
  namespace?: string;
}

/** Pure snapshot and driver validation shared by declarations and direct construction. */
function snapshotCacheStoreOptions(
  options: Readonly<CreateCacheStoreOptions>,
  requireExplicitNamespace = false,
): Readonly<CreateCacheStoreOptions> {
  if (options === null || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("Cache options must be a plain data record.");
  const descriptors = Object.getOwnPropertyDescriptors(options);
  // Omitted optional settings and explicit undefined have the same meaning.
  for (const key of ["redisUrl", "redis", "namespace"]) {
    const descriptor = descriptors[key];
    if (descriptor && "value" in descriptor && descriptor.value === undefined)
      delete descriptors[key];
  }
  const data = Object.create(Object.getPrototypeOf(options), descriptors);
  const copied = copyApplicationConfig(data) as unknown as CreateCacheStoreOptions;
  if (requireExplicitNamespace) validateCacheNamespace(copied.namespace as string);
  const namespace = copied.namespace === undefined ? DEFAULT_CACHE_NAMESPACE : copied.namespace;
  validateCacheNamespace(namespace);
  if (copied.driver === "redis") {
    if (typeof copied.redisUrl !== "string" || !copied.redisUrl) {
      throw new Error('CACHE_DRIVER="redis" requires REDIS_URL to be set.');
    }
    const redis = normalizeRedisCacheOptions(copied.ttlMs, copied.maxEntries, copied.redis);
    return Object.freeze({ ...copied, namespace, redis });
  }
  if (copied.driver !== "array") throw new TypeError("Unknown cache driver.");
  validateSimpleCacheOptions(copied.ttlMs, copied.maxEntries);
  return Object.freeze({ ...copied, namespace });
}

function createCacheStore(options: Readonly<CreateCacheStoreOptions>): CacheStore {
  const copied = snapshotCacheStoreOptions(options);
  if (copied.driver === "redis") {
    return new RedisCacheStore(
      copied.redisUrl as string,
      copied.ttlMs,
      copied.maxEntries,
      copied.redis,
      copied.namespace,
    );
  }
  return new SimpleCacheStore(new SimpleCache(copied.ttlMs, copied.maxEntries));
}

export type { CacheDriver, CreateCacheStoreOptions, RedisCacheOptions };
export { createCacheStore, snapshotCacheStoreOptions };
