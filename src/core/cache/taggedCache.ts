import type { CacheStore } from "./store";

class TaggedCache {
  constructor(
    private readonly store: CacheStore,
    private readonly tags: string[],
  ) {}

  async put<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.store.set(key, value, ttlMs, this.tags);
  }

  async forever<T>(key: string, value: T): Promise<void> {
    await this.store.set(key, value, null, this.tags);
  }

  async remember<T>(
    key: string,
    callback: (signal?: AbortSignal) => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    if (this.store.getOrSetTagged)
      return this.store.getOrSetTagged(key, callback, this.tags, ttlMs);
    const value = await this.store.getOrSet(key, callback, ttlMs);
    await this.store.attachTags(key, this.tags);
    return value;
  }

  async flush(): Promise<number> {
    return this.store.flushTags(this.tags);
  }
}

export default TaggedCache;
