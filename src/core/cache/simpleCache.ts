type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  lastAccessedAt: number;
};

class SimpleCache {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

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

  set<T>(key: string, value: T): void {
    const now = Date.now();

    this.cache.set(key, {
      value,
      expiresAt: now + this.ttlMs,
      lastAccessedAt: now,
    });

    this.evictOverflow();
  }

  async getOrSet<T>(key: string, loader: () => Promise<T>): Promise<T> {
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
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, pendingRequest);
    return pendingRequest;
  }

  invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  size(): number {
    this.pruneExpired();
    return this.cache.size;
  }

  private getFreshEntry<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    return entry;
  }

  private pruneExpired(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
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

      this.cache.delete(oldestKey);
    }
  }
}

export default SimpleCache;
