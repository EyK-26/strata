interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
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
