import type { CacheStore } from "./store";

class TaggedCache {
  constructor(
    private readonly store: CacheStore,
    private readonly tags: string[],
  ) {
    if (typeof store.getOrSetTagged !== "function") {
      throw new TypeError("Cache tags require atomic tagged loading support.");
    }
  }

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
    return this.store.getOrSetTagged(key, callback, this.tags, ttlMs);
  }

  async flush(): Promise<number> {
    return this.store.flushTags(this.tags);
  }
}

export default TaggedCache;
