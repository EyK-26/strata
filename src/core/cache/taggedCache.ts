import type { CacheStore } from "./store";

class TaggedCache {
  constructor(
    private readonly store: CacheStore,
    private readonly tags: string[],
  ) {}

  async remember<T>(
    key: string,
    callback: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const value = await this.store.getOrSet(key, callback, ttlMs);
    await this.store.attachTags(key, this.tags);
    return value;
  }

  async flush(): Promise<number> {
    return this.store.flushTags(this.tags);
  }
}

export default TaggedCache;
