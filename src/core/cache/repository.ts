import type { CacheLike } from "../../types/services";
import type { ExecutionOperations } from "../contracts/executionOperations";
import type { CacheStore } from "./store";
import TaggedCache from "./taggedCache";

class CacheRepository {
  constructor(private readonly store: CacheStore) {}

  async close(): Promise<void> {
    await this.store.close?.();
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get<T>(key);
  }

  async put<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.store.set(key, value, ttlMs);
  }

  async forever<T>(key: string, value: T): Promise<void> {
    await this.store.set(key, value, null);
  }

  async remember<T>(
    key: string,
    callback: (signal?: AbortSignal) => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    return this.store.getOrSet(key, callback, ttlMs);
  }

  async forget(key: string): Promise<boolean> {
    return this.store.invalidate(key);
  }

  async flush(): Promise<void> {
    await this.store.clear();
  }

  tags(...names: string[]): TaggedCache {
    return new TaggedCache(this.store, names);
  }

  async getOrSet<T>(
    key: string,
    loader: (signal?: AbortSignal) => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    return this.remember(key, loader, ttlMs);
  }

  async invalidate(key: string): Promise<boolean> {
    return this.forget(key);
  }

  async invalidateByPrefix(prefix: string): Promise<number> {
    return this.store.invalidateByPrefix(prefix);
  }

  async clear(): Promise<void> {
    await this.flush();
  }

  async size(): Promise<number> {
    return this.store.size();
  }
}

/** Scoped authority delegates to the existing backend; the kernel owns actual work. */
function createGuardedCache(backend: CacheRepository, operations: ExecutionOperations): CacheLike {
  const remember: CacheLike["remember"] = (key, loader, ttlMs) =>
    operations.operation(() =>
      backend.remember(key, (signal) => operations.operation(() => loader(signal)), ttlMs),
    );
  const forget: CacheLike["forget"] = (key) => operations.operation(() => backend.forget(key));
  const flush: CacheLike["flush"] = () => operations.operation(() => backend.flush());
  return Object.freeze({
    put: <T>(key: string, value: T, ttlMs?: number) =>
      operations.operation(() => backend.put(key, value, ttlMs)),
    forever: <T>(key: string, value: T) => operations.operation(() => backend.forever(key, value)),
    get: <T>(key: string) => operations.operation(() => backend.get<T>(key)),
    remember,
    forget,
    flush,
    tags: (...names: string[]) => {
      operations.assertActive();
      const tags = [...names];
      return Object.freeze({
        put: <T>(key: string, value: T, ttlMs?: number) =>
          operations.operation(() => backend.tags(...tags).put(key, value, ttlMs)),
        forever: <T>(key: string, value: T) =>
          operations.operation(() => backend.tags(...tags).forever(key, value)),
        remember: <T>(key: string, loader: (signal?: AbortSignal) => Promise<T>, ttlMs?: number) =>
          operations.operation(() =>
            backend
              .tags(...tags)
              .remember(key, (signal) => operations.operation(() => loader(signal)), ttlMs),
          ),
        flush: () => operations.operation(() => backend.tags(...tags).flush()),
      });
    },
    getOrSet: remember,
    invalidate: forget,
    invalidateByPrefix: (prefix: string) =>
      operations.operation(() => backend.invalidateByPrefix(prefix)),
    clear: flush,
    size: () => operations.operation(() => backend.size()),
  });
}

export { CacheRepository, createGuardedCache };
export default CacheRepository;
