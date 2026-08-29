import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import type { CacheStore } from "./store";

function cacheKeyPrefix(): string {
  return namespacedRedisKey("cache:");
}

function cacheTagPrefix(): string {
  return namespacedRedisKey("cache:tag:");
}

class RedisCacheStore implements CacheStore {
  private readonly client: RedisClient;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly keyTags = new Map<string, Set<string>>();

  constructor(
    redisUrl: string,
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {
    this.client = new RedisClient(redisUrl);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(this.storageKey(key));

    if (raw === null) {
      return undefined;
    }

    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const resolvedTtlMs = ttlMs ?? this.ttlMs;
    const payload = JSON.stringify(value);

    if (resolvedTtlMs > 0) {
      await this.client.psetex(this.storageKey(key), resolvedTtlMs, payload);
    } else {
      await this.client.set(this.storageKey(key), payload);
    }

    await this.enforceMaxEntries();
  }

  async getOrSet<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = await this.get<T>(key);

    if (cached !== undefined) {
      return cached;
    }

    const inflightRequest = this.inflight.get(key) as Promise<T> | undefined;

    if (inflightRequest) {
      return inflightRequest;
    }

    const pendingRequest = loader()
      .then(async (value) => {
        await this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, pendingRequest);
    return pendingRequest;
  }

  async attachTags(key: string, tags: string[]): Promise<void> {
    if (tags.length === 0) {
      return;
    }

    let tagsForKey = this.keyTags.get(key);

    if (!tagsForKey) {
      tagsForKey = new Set();
      this.keyTags.set(key, tagsForKey);
    }

    for (const tag of tags) {
      tagsForKey.add(tag);
      await this.client.sadd(this.tagKey(tag), key);
    }
  }

  async flushTags(tags: string[]): Promise<number> {
    const keysToRemove = new Set<string>();

    for (const tag of tags) {
      const members = await this.client.smembers(this.tagKey(tag));

      for (const member of members) {
        keysToRemove.add(member);
      }
    }

    let removed = 0;

    for (const key of keysToRemove) {
      if (await this.invalidate(key)) {
        removed += 1;
      }
    }

    for (const tag of tags) {
      await this.client.del(this.tagKey(tag));
    }

    return removed;
  }

  async invalidate(key: string): Promise<boolean> {
    const deleted = await this.client.del(this.storageKey(key));
    await this.detachKeyFromTags(key);
    return deleted > 0;
  }

  async invalidateByPrefix(prefix: string): Promise<number> {
    const keys = await this.client.keys(`${cacheKeyPrefix()}*`);
    let removed = 0;

    for (const storageKey of keys) {
      const key = storageKey.slice(cacheKeyPrefix().length);

      if (key === prefix || key.startsWith(`${prefix}?`)) {
        if (await this.invalidate(key)) {
          removed += 1;
        }
      }
    }

    return removed;
  }

  async clear(): Promise<void> {
    const keys = await this.client.keys(`${cacheKeyPrefix()}*`);

    if (keys.length > 0) {
      await this.client.del(...keys);
    }

    const tagKeys = await this.client.keys(`${cacheTagPrefix()}*`);

    if (tagKeys.length > 0) {
      await this.client.del(...tagKeys);
    }

    this.inflight.clear();
    this.keyTags.clear();
  }

  async size(): Promise<number> {
    const keys = await this.client.keys(`${cacheKeyPrefix()}*`);
    return keys.length;
  }

  private storageKey(key: string): string {
    return `${cacheKeyPrefix()}${key}`;
  }

  private tagKey(tag: string): string {
    return `${cacheTagPrefix()}${tag}`;
  }

  private async detachKeyFromTags(key: string): Promise<void> {
    const tags = this.keyTags.get(key);

    if (!tags) {
      return;
    }

    for (const tag of tags) {
      await this.client.srem(this.tagKey(tag), key);
    }

    this.keyTags.delete(key);
  }

  private async enforceMaxEntries(): Promise<void> {
    const keys = await this.client.keys(`${cacheKeyPrefix()}*`);

    if (keys.length <= this.maxEntries) {
      return;
    }

    const overflow = keys.length - this.maxEntries;
    const keysToRemove = keys.slice(0, overflow);

    if (keysToRemove.length > 0) {
      await this.client.del(...keysToRemove);
    }
  }
}

export default RedisCacheStore;
