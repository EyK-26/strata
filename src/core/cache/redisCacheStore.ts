import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import { CACHE_SCRIPT } from "./redisCacheScript.ts";
import type { CacheStore } from "./store";

type RedisCacheOptions = {
  commandTimeoutMs?: number;
  leaseMs?: number;
  fillTimeoutMs?: number;
  waitTimeoutMs?: number;
  pollMs?: number;
  metadataTtlMs?: number;
  metadataLimit?: number;
};

// Only these five explicitly supplied keys are accessed. Values and identities
// are fields/members, so eviction never enumerates the Redis keyspace. All keys
// share a hash slot; scripts validate destination types before changing state.

type ScriptResult = {
  kind?: "value" | "missing" | "owner" | "wait";
  payload?: string;
  owned?: boolean;
  removed?: number;
  size?: number;
};

class RedisCacheStore implements CacheStore {
  private client: RedisClient | undefined;
  private readonly keys: string[];
  private readonly options: Required<RedisCacheOptions>;
  private readonly fills = new Set<AbortController>();
  private closed = false;

  constructor(
    private readonly redisUrl: string,
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    options: RedisCacheOptions = {},
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0)
      throw new RangeError("ttlMs must be a non-negative safe integer.");
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000)
      throw new RangeError("maxEntries must be between 1 and 10000.");
    this.options = {
      commandTimeoutMs: 5000,
      leaseMs: 10_000,
      fillTimeoutMs: 30_000,
      waitTimeoutMs: 35_000,
      pollMs: 25,
      metadataTtlMs: 60_000,
      metadataLimit: 4096,
      ...options,
    };
    for (const [key, value] of Object.entries(this.options))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new RangeError(`${key} must be a positive safe integer.`);
    if (
      this.options.leaseMs < 30 ||
      this.options.fillTimeoutMs < this.options.leaseMs ||
      this.options.metadataTtlMs < this.options.fillTimeoutMs + this.options.leaseMs ||
      this.options.metadataLimit < 66 ||
      this.options.metadataLimit > 100_000
    )
      throw new RangeError("Invalid Redis cache lease, deadline or metadata bounds.");
    const namespace = namespacedRedisKey("cache:v3:");
    const slot = new Bun.CryptoHasher("sha256").update(namespace).digest("hex");
    this.keys = ["entries", "expiry", "order", "metadata", "metadata-expiry"].map(
      (name) => `${namespace}{${slot}}:${name}`,
    );
    this.client = this.createClient();
  }

  private createClient(): RedisClient {
    return new RedisClient(this.redisUrl, {
      connectionTimeout: this.options.commandTimeoutMs,
      maxRetries: 1,
    });
  }

  close(): void {
    this.closed = true;
    for (const fill of this.fills) fill.abort(new Error("Redis cache store is closed."));
    this.client?.close();
    this.client = undefined;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const result = await this.execute("get", key);
    return result.kind === "value" ? (JSON.parse(result.payload ?? "null") as T) : undefined;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.execute("set", key, { payload: this.serialize(value), ttlMs: ttlMs ?? this.ttlMs });
  }

  async getOrSet<T>(
    key: string,
    loader: (signal?: AbortSignal) => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    return this.getOrSetTagged(key, loader, [], ttlMs);
  }

  async getOrSetTagged<T>(
    key: string,
    loader: (signal?: AbortSignal) => Promise<T>,
    tags: string[],
    ttlMs?: number,
  ): Promise<T> {
    const owner = crypto.randomUUID();
    const end = performance.now() + this.options.waitTimeoutMs;
    while (!this.closed) {
      const claim = await this.execute("claim", key, { owner, tags, ttlMs: ttlMs ?? this.ttlMs });
      if (claim.kind === "value") return JSON.parse(claim.payload ?? "null") as T;
      if (claim.kind === "owner") return this.fill(key, owner, loader, ttlMs);
      if (performance.now() >= end) throw new Error("Redis cache fill wait deadline exceeded.");
      await Bun.sleep(this.options.pollMs);
    }
    throw new Error("Redis cache store is closed.");
  }

  async attachTags(key: string, tags: string[]): Promise<void> {
    await this.execute("attach", key, { tags });
  }
  async flushTags(tags: string[]): Promise<number> {
    return (await this.execute("tags", "", { tags })).removed ?? 0;
  }
  async invalidate(key: string): Promise<boolean> {
    return ((await this.execute("invalidate", key)).removed ?? 0) > 0;
  }
  async invalidateByPrefix(prefix: string): Promise<number> {
    return (await this.execute("prefix", prefix)).removed ?? 0;
  }
  async clear(): Promise<void> {
    await this.execute("clear", "");
  }
  async size(): Promise<number> {
    return (await this.execute("size", "")).size ?? 0;
  }

  private async fill<T>(
    key: string,
    owner: string,
    loader: (signal?: AbortSignal) => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    if (this.fills.size >= this.maxEntries) {
      await this.execute("release", key, { owner });
      throw new Error("Redis cache local fill capacity exceeded.");
    }
    const controller = new AbortController();
    this.fills.add(controller);
    let done = false;
    let renewing = false;
    const renew = setInterval(
      () => {
        if (renewing || done) return;
        renewing = true;
        void this.execute("renew", key, { owner })
          .then((result) => {
            // Lost ownership fences publication. A caller may still receive its
            // completed loader value, but it cannot install it in the shared cache.
            if (!result.owned) clearInterval(renew);
          })
          .catch((error) => {
            if (!done) controller.abort(error);
          })
          .finally(() => {
            renewing = false;
          });
      },
      Math.max(10, Math.floor(this.options.leaseMs / 3)),
    );
    const timeout = setTimeout(
      () => controller.abort(new Error("Redis cache fill deadline exceeded.")),
      this.options.fillTimeoutMs,
    );
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => loader(controller.signal)),
        aborted,
      ]);
      controller.signal.throwIfAborted();
      done = true;
      clearInterval(renew);
      await this.execute("publish", key, {
        owner,
        payload: this.serialize(value),
        ttlMs: ttlMs ?? this.ttlMs,
      });
      return value;
    } finally {
      done = true;
      clearInterval(renew);
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", rejectAbort);
      this.fills.delete(controller);
      // Release is best effort; if Redis is unavailable, the finite lease still
      // expires. Read/claim/renew/publication errors are never process-local fallbacks.
      if (!this.closed) await this.execute("release", key, { owner }).catch(() => {});
    }
  }

  private serialize(value: unknown): string {
    const payload = JSON.stringify(value);
    if (typeof payload !== "string")
      throw new TypeError("Redis cache values must be JSON serializable.");
    return payload;
  }

  private async execute(
    op: string,
    key: string,
    extra: Record<string, unknown> = {},
  ): Promise<ScriptResult> {
    if (this.closed) throw new Error("Redis cache store is closed.");
    if (Buffer.byteLength(key) > 4096) throw new RangeError("Invalid Redis cache identity.");
    const tags = Array.from(new Set((extra.tags ?? []) as string[]));
    if (
      tags.length > 32 ||
      tags.some((tag) => typeof tag !== "string" || Buffer.byteLength(tag) > 1024)
    )
      throw new RangeError("Redis cache supports at most 32 tags of 1024 bytes each.");
    const prefixes = [key];
    for (let i = 0; i < key.length; i++) if (key[i] === "?") prefixes.push(key.slice(0, i));
    if (prefixes.length > 33)
      throw new RangeError("Redis cache identities support at most 32 query separators.");
    const ttlMs = extra.ttlMs ?? this.ttlMs;
    if (typeof ttlMs !== "number" || !Number.isSafeInteger(ttlMs) || ttlMs < 0)
      throw new RangeError("ttlMs must be a non-negative safe integer.");
    if (!this.client) this.client = this.createClient();
    const client = this.client;
    const retire = (reason: unknown) => {
      if (this.client !== client) return;
      this.client = undefined;
      for (const fill of this.fills) fill.abort(reason);
      client.close();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("Redis cache command deadline exceeded.");
        reject(error);
        retire(error);
      }, this.options.commandTimeoutMs);
    });
    try {
      const raw = await Promise.race([
        client.send("EVAL", [
          CACHE_SCRIPT,
          String(this.keys.length),
          ...this.keys,
          JSON.stringify({
            op,
            key,
            capacity: this.maxEntries,
            owner: crypto.randomUUID(),
            ...this.options,
            ...extra,
            tags,
            prefixes,
            ttlMs,
          }),
        ]),
        timeout,
      ]);
      if (this.closed || this.client !== client)
        throw new Error("Redis cache connection was retired.");
      return JSON.parse(String(raw)) as ScriptResult;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code.startsWith("ERR_REDIS_CONNECTION")
      )
        retire(error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export type { RedisCacheOptions };
export default RedisCacheStore;
