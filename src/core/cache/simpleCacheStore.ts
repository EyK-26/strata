import type SimpleCache from "./simpleCache";
import type { CacheStore } from "./store";

class SimpleCacheStore implements CacheStore {
  constructor(private readonly cache: SimpleCache) {}

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.cache.get<T>(key));
  }

  set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.cache.set(key, value, ttlMs);
    return Promise.resolve();
  }

  getOrSet<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    return this.cache.getOrSet(key, loader, ttlMs);
  }

  attachTags(key: string, tags: string[]): Promise<void> {
    this.cache.attachTags(key, tags);
    return Promise.resolve();
  }

  flushTags(tags: string[]): Promise<number> {
    return Promise.resolve(this.cache.flushTags(tags));
  }

  invalidate(key: string): Promise<boolean> {
    return Promise.resolve(this.cache.invalidate(key));
  }

  invalidateByPrefix(prefix: string): Promise<number> {
    return Promise.resolve(this.cache.invalidateByPrefix(prefix));
  }

  clear(): Promise<void> {
    this.cache.clear();
    return Promise.resolve();
  }

  size(): Promise<number> {
    return Promise.resolve(this.cache.size());
  }
}

export { SimpleCacheStore };
export default SimpleCacheStore;
