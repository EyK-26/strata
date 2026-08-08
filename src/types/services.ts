interface CacheLike {
  get<T>(key: string): Promise<T | undefined>;
  remember<T>(key: string, callback: () => Promise<T>, ttlMs?: number): Promise<T>;
  forget(key: string): Promise<boolean>;
  flush(): Promise<void>;
  tags(...names: string[]): {
    remember<T>(key: string, callback: () => Promise<T>, ttlMs?: number): Promise<T>;
    flush(): Promise<number>;
  };
  getOrSet<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T>;
  invalidate(key: string): Promise<boolean>;
  invalidateByPrefix(prefix: string): Promise<number>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

export type { CacheLike };
