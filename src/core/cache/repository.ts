import type { CacheStore } from "./store";
import TaggedCache from "./taggedCache";

class CacheRepository {
  constructor(private readonly store: CacheStore) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get<T>(key);
  }

  async remember<T>(key: string, callback: () => Promise<T>, ttlMs?: number): Promise<T> {
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

  async getOrSet<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
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

export default CacheRepository;
