interface CacheStore {
  close?(): void | Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  getOrSet<T>(
    key: string,
    loader: (signal?: AbortSignal) => Promise<T>,
    ttlMs?: number,
  ): Promise<T>;
  /** Shared stores can bind tags before starting a fill. */
  getOrSetTagged?<T>(
    key: string,
    loader: (signal?: AbortSignal) => Promise<T>,
    tags: string[],
    ttlMs?: number,
  ): Promise<T>;
  attachTags(key: string, tags: string[]): Promise<void>;
  flushTags(tags: string[]): Promise<number>;
  invalidate(key: string): Promise<boolean>;
  invalidateByPrefix(prefix: string): Promise<number>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

export type { CacheStore };
