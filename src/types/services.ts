interface CacheLike {
  put<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  forever<T>(key: string, value: T): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  remember<T>(
    key: string,
    callback: (signal?: AbortSignal) => Promise<T>,
    ttlMs?: number,
  ): Promise<T>;
  forget(key: string): Promise<boolean>;
  flush(): Promise<void>;
  tags(...names: string[]): {
    put<T>(key: string, value: T, ttlMs?: number): Promise<void>;
    forever<T>(key: string, value: T): Promise<void>;
    remember<T>(
      key: string,
      callback: (signal?: AbortSignal) => Promise<T>,
      ttlMs?: number,
    ): Promise<T>;
    flush(): Promise<number>;
  };
  getOrSet<T>(
    key: string,
    loader: (signal?: AbortSignal) => Promise<T>,
    ttlMs?: number,
  ): Promise<T>;
  invalidate(key: string): Promise<boolean>;
  invalidateByPrefix(prefix: string): Promise<number>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

export type { CacheLike };
