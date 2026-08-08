type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  lastAccessedAt: number;
};

class SimpleCache {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly keyTags = new Map<string, Set<string>>();

  constructor(
    private readonly ttlMs: number = 3_600_000,
    private readonly maxEntries: number = 100,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError("ttlMs must be a non-negative number.");
    }

    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer.");
    }
  }

  get<T>(key: string): T | undefined {
    return this.getFreshEntry<T>(key)?.value;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const resolvedTtlMs = ttlMs ?? this.ttlMs;

    this.cache.set(key, {
      value,
      expiresAt: now + resolvedTtlMs,
      lastAccessedAt: now,
    });

    this.evictOverflow();
  }

  async getOrSet<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    this.pruneExpired();

    const cachedEntry = this.getFreshEntry<T>(key);
    if (cachedEntry) {
      return cachedEntry.value;
    }

    const inflightRequest = this.inflight.get(key) as Promise<T> | undefined;
    if (inflightRequest) {
      return inflightRequest;
    }

    const pendingRequest = loader()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, pendingRequest);
    return pendingRequest;
  }

  attachTags(key: string, tags: string[]): void {
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

      let keysForTag = this.tagIndex.get(tag);

      if (!keysForTag) {
        keysForTag = new Set();
        this.tagIndex.set(tag, keysForTag);
      }

      keysForTag.add(key);
    }
  }

  flushTags(tags: string[]): number {
    const keysToRemove = new Set<string>();

    for (const tag of tags) {
      const keys = this.tagIndex.get(tag);

      if (!keys) {
        continue;
      }

      for (const key of keys) {
        keysToRemove.add(key);
      }
    }

    let removed = 0;

    for (const key of keysToRemove) {
      if (this.invalidate(key)) {
        removed += 1;
      }
    }

    for (const tag of tags) {
      this.tagIndex.delete(tag);
    }

    return removed;
  }

  invalidate(key: string): boolean {
    const removed = this.cache.delete(key);

    if (removed) {
      this.detachKeyFromTags(key);
    }

    return removed;
  }

  invalidateByPrefix(prefix: string): number {
    let removed = 0;

    for (const key of [...this.cache.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}?`)) {
        if (this.invalidate(key)) {
          removed += 1;
        }
      }
    }

    return removed;
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
    this.tagIndex.clear();
    this.keyTags.clear();
  }

  size(): number {
    this.pruneExpired();
    return this.cache.size;
  }

  private detachKeyFromTags(key: string): void {
    const tags = this.keyTags.get(key);

    if (!tags) {
      return;
    }

    for (const tag of tags) {
      const keys = this.tagIndex.get(tag);

      if (!keys) {
        continue;
      }

      keys.delete(key);

      if (keys.size === 0) {
        this.tagIndex.delete(tag);
      }
    }

    this.keyTags.delete(key);
  }

  private getFreshEntry<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.invalidate(key);
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    return entry;
  }

  private pruneExpired(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.invalidate(key);
      }
    }
  }

  private evictOverflow(): void {
    while (this.cache.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestAccessTime = Number.POSITIVE_INFINITY;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccessedAt < oldestAccessTime) {
          oldestAccessTime = entry.lastAccessedAt;
          oldestKey = key;
        }
      }

      if (!oldestKey) {
        return;
      }

      this.invalidate(oldestKey);
    }
  }
}

export default SimpleCache;
