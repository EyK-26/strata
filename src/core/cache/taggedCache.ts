import type { CacheStore } from "./store";

class TaggedCache {
  constructor(
    private readonly store: CacheStore,
    private readonly tags: string[],
  ) {}

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
