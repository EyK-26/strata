interface MemoryThrottleStorageOptions {
  /** Maximum live identities retained per middleware instance. */
  maxBuckets?: number;
  /** Maximum expired entries removed on each attempt. */
  pruneBatchSize?: number;
}

interface MemoryThrottleStats {
  readonly retainedBuckets: number;
  readonly prunedOnLastConsume: number;
  readonly disposed: boolean;
}

/** Fixed-window insertion order also orders expiry; hits never refresh a window. */
class BoundedThrottleStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly maxBuckets: number;
  private readonly pruneBatchSize: number;
  private disposed = false;
  private pruned = 0;

  constructor(
    private readonly decayMs: number,
    options: MemoryThrottleStorageOptions = {},
    private readonly now: () => number = () => performance.now(),
  ) {
    this.maxBuckets = options.maxBuckets ?? 10_000;
    this.pruneBatchSize = options.pruneBatchSize ?? 32;
    if (!Number.isFinite(decayMs) || decayMs < 0 || decayMs > 2_147_483_647) {
      throw new Error("Invalid memory throttle window.");
    }
    if (
      !Number.isSafeInteger(this.maxBuckets) ||
      this.maxBuckets < 1 ||
      this.maxBuckets > 1_000_000 ||
      !Number.isSafeInteger(this.pruneBatchSize) ||
      this.pruneBatchSize < 1 ||
      this.pruneBatchSize > 1024
    ) {
      throw new Error("Invalid memory throttle storage bounds.");
    }
  }

  /** null means closed or saturated: callers must fail closed, never evict live buckets. */
  consume(key: string): number | null {
    this.pruned = 0;
    if (this.disposed) return null;
    const now = this.now();
    const entries = this.buckets.entries();
    for (let i = 0; i < this.pruneBatchSize; i++) {
      const oldest = entries.next().value;
      if (!oldest || oldest[1].resetAt > now) break;
      this.buckets.delete(oldest[0]);
      this.pruned++;
    }
    const existing = this.buckets.get(key);
    if (existing && existing.resetAt > now) {
      existing.count = Math.min(Number.MAX_SAFE_INTEGER, existing.count + 1);
      return existing.count;
    }
    this.buckets.delete(key);
    if (this.buckets.size >= this.maxBuckets) return null;
    this.buckets.set(key, { count: 1, resetAt: now + this.decayMs });
    return 1;
  }

  clear(): void {
    this.buckets.clear();
  }
  dispose(): void {
    this.disposed = true;
    this.clear();
  }
  stats(): MemoryThrottleStats {
    return {
      retainedBuckets: this.buckets.size,
      prunedOnLastConsume: this.pruned,
      disposed: this.disposed,
    };
  }
}

export type { MemoryThrottleStats, MemoryThrottleStorageOptions };
export { BoundedThrottleStore };
