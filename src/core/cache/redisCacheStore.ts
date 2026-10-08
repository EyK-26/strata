import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
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
const CACHE_SCRIPT = `
local expected = {'hash', 'zset', 'zset', 'hash', 'zset'}
for i, key in ipairs(KEYS) do
  local kind = redis.call('TYPE', key).ok
  if kind ~= 'none' and kind ~= expected[i] then return redis.error_reply('Unexpected cache key type') end
end
-- Redis eviction can remove one container without its companions. Never read
-- orphaned values or leases after losing the expiry/order/generation indexes.
local entries = redis.call('HLEN', KEYS[1])
local order = redis.call('ZCARD', KEYS[3])
if redis.call('ZCARD', KEYS[2]) ~= order or entries ~= (order > 0 and order + 1 or 0) then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
end
if redis.call('HLEN', KEYS[4]) ~= redis.call('ZCARD', KEYS[5]) then
  redis.call('DEL', KEYS[4], KEYS[5])
end
local r = cjson.decode(ARGV[1])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + tonumber(time[2]) / 1000
local function removeEntry(key)
  local removed = redis.call('HDEL', KEYS[1], 'e:' .. key)
  redis.call('ZREM', KEYS[2], key)
  redis.call('ZREM', KEYS[3], key)
  return removed
end
local function removeMeta(field)
  redis.call('HDEL', KEYS[4], field)
  redis.call('ZREM', KEYS[5], field)
end
for _, key in ipairs(redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, r.capacity)) do removeEntry(key) end
for _, field in ipairs(redis.call('ZRANGEBYSCORE', KEYS[5], '-inf', now, 'LIMIT', 0, r.metadataLimit)) do removeMeta(field) end
local function expireContainers()
  local last = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  if #last == 0 then
    redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
  elseif last[2] == 'inf' then
    for i = 1, 3 do redis.call('PERSIST', KEYS[i]) end
  else
    local ttl = math.max(1, math.ceil(tonumber(last[2]) - now))
    for i = 1, 3 do redis.call('PEXPIRE', KEYS[i], ttl) end
  end
  for i = 4, 5 do redis.call('PEXPIRE', KEYS[i], r.metadataTtlMs) end
end
local function response(value)
  expireContainers()
  return cjson.encode(value)
end
local function addTags(existing, added)
  local seen = {}
  local result = {}
  for _, tags in ipairs({existing, added}) do
    for _, tag in ipairs(tags) do
      if not seen[tag] then seen[tag] = true; table.insert(result, tag) end
    end
  end
  if #result > 32 then error('Cache entries support at most 32 tags') end
  return result
end
local function touch(key)
  local sequence = redis.call('HINCRBY', KEYS[1], '_sequence', 1)
  redis.call('ZADD', KEYS[3], sequence, key)
end
local function read(key, tags)
  local raw = redis.call('HGET', KEYS[1], 'e:' .. key)
  if not raw then return nil end
  local entry = cjson.decode(raw)
  if #tags > 0 then
    entry.tags = addTags(entry.tags, tags)
    redis.call('HSET', KEYS[1], 'e:' .. key, cjson.encode(entry))
  end
  touch(key)
  return entry.payload
end
local function write(key, payload, tags)
  local entry = {payload=payload, tags=tags}
  redis.call('HSET', KEYS[1], 'e:' .. key, cjson.encode(entry))
  redis.call('ZADD', KEYS[2], r.ttlMs == 0 and '+inf' or now + r.ttlMs, key)
  touch(key)
  local overflow = redis.call('ZCARD', KEYS[3]) - r.capacity
  if overflow > 0 then
    for _, victim in ipairs(redis.call('ZRANGE', KEYS[3], 0, overflow - 1)) do removeEntry(victim) end
  end
end
local leaseField = 'l:' .. r.key
local function lease()
  local raw = redis.call('HGET', KEYS[4], leaseField)
  if not raw then return nil end
  local value = cjson.decode(raw)
  if value.expires <= now or value.deadline <= now then removeMeta(leaseField); return nil end
  return value
end
local function metadataSpace(count)
  if redis.call('HLEN', KEYS[4]) + count > r.metadataLimit then
    -- Pressure sheds generation/lease state. Every old owner is fenced; cached
    -- entries remain valid because invalidation removes matching entries atomically.
    redis.call('DEL', KEYS[4], KEYS[5])
  end
end
local function putMeta(field, value, expires)
  redis.call('HSET', KEYS[4], field, value)
  redis.call('ZADD', KEYS[5], expires, field)
end
local function scopes()
  local fields = {}
  for _, tag in ipairs(r.tags) do table.insert(fields, 'g:tag:' .. tag) end
  for _, prefix in ipairs(r.prefixes) do table.insert(fields, 'g:prefix:' .. prefix) end
  return fields
end
local function matches(key, tags)
  if r.op == 'invalidate' then return key == r.key end
  if r.op == 'prefix' then return key == r.key or string.sub(key, 1, #r.key + 1) == r.key .. '?' end
  if r.op == 'tags' then
    for _, existing in ipairs(tags) do
      for _, wanted in ipairs(r.tags) do if wanted == existing then return true end end
    end
  end
  return false
end
if r.op == 'clear' then
  redis.call('DEL', unpack(KEYS))
  return cjson.encode({removed=0})
elseif r.op == 'get' then
  local payload = read(r.key, r.tags)
  return response(payload and {kind='value', payload=payload} or {kind='missing'})
elseif r.op == 'set' then
  local old = redis.call('HGET', KEYS[1], 'e:' .. r.key)
  local tags = old and cjson.decode(old).tags or {}
  write(r.key, r.payload, tags)
  removeMeta(leaseField)
  return response({written=true})
elseif r.op == 'attach' then
  read(r.key, r.tags)
  return response({written=true})
elseif r.op == 'size' then
  return response({size=redis.call('ZCARD', KEYS[3])})
elseif r.op == 'tags' or r.op == 'prefix' or r.op == 'invalidate' then
  local generationFields = {}
  if r.op == 'tags' then
    for _, tag in ipairs(r.tags) do table.insert(generationFields, 'g:tag:' .. tag) end
  elseif r.op == 'prefix' then table.insert(generationFields, 'g:prefix:' .. r.key) end
  metadataSpace(#generationFields)
  for _, field in ipairs(generationFields) do putMeta(field, r.owner, now + r.metadataTtlMs) end
  local removed = 0
  for _, key in ipairs(redis.call('ZRANGE', KEYS[3], 0, -1)) do
    local raw = redis.call('HGET', KEYS[1], 'e:' .. key)
    if raw and matches(key, cjson.decode(raw).tags) then removed = removed + removeEntry(key) end
  end
  for _, field in ipairs(redis.call('HKEYS', KEYS[4])) do
    if string.sub(field, 1, 2) == 'l:' then
      local value = cjson.decode(redis.call('HGET', KEYS[4], field))
      if matches(string.sub(field, 3), value.tags) then removeMeta(field) end
    end
  end
  return response({removed=removed})
elseif r.op == 'claim' then
  local payload = read(r.key, r.tags)
  if payload then return response({kind='value', payload=payload}) end
  local current = lease()
  if current then
    local shared = addTags(current.tags, r.tags)
    if #shared == #current.tags then return response({kind='wait'}) end
    -- A newly requested tag must not inherit a fill started before that tag's
    -- invalidation. Restart with the union of tags and a new owner.
    r.tags = shared
    removeMeta(leaseField)
  end
  local active = 0
  for _, field in ipairs(redis.call('HKEYS', KEYS[4])) do if string.sub(field, 1, 2) == 'l:' then active = active + 1 end end
  if active >= r.capacity then return response({kind='wait'}) end
  local fields = scopes()
  metadataSpace(#fields + 1)
  local generations = {}
  for _, field in ipairs(fields) do
    local token = redis.call('HGET', KEYS[4], field) or r.owner
    putMeta(field, token, now + r.metadataTtlMs)
    generations[field] = token
  end
  local value = {owner=r.owner, tags=r.tags, generations=generations, deadline=now + r.fillTimeoutMs, expires=now + r.leaseMs}
  putMeta(leaseField, cjson.encode(value), value.expires)
  return response({kind='owner'})
elseif r.op == 'renew' or r.op == 'publish' or r.op == 'release' then
  local current = lease()
  if not current or current.owner ~= r.owner then return response({owned=false}) end
  if r.op == 'release' then removeMeta(leaseField); return response({owned=true}) end
  for field, token in pairs(current.generations) do
    if redis.call('HGET', KEYS[4], field) ~= token then removeMeta(leaseField); return response({owned=false}) end
  end
  if r.op == 'renew' then
    current.expires = math.min(current.deadline, now + r.leaseMs)
    putMeta(leaseField, cjson.encode(current), current.expires)
  else
    write(r.key, r.payload, current.tags)
    removeMeta(leaseField)
  end
  return response({owned=true})
end
return redis.error_reply('Unknown cache operation')
`;

type ScriptResult = {
  kind?: "value" | "missing" | "owner" | "wait";
  payload?: string;
  owned?: boolean;
  removed?: number;
  size?: number;
};

class RedisCacheStore implements CacheStore {
  private readonly client: RedisClient;
  private readonly keys: string[];
  private readonly options: Required<RedisCacheOptions>;
  private readonly fills = new Set<AbortController>();
  private closed = false;

  constructor(
    redisUrl: string,
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
    this.client = new RedisClient(redisUrl, {
      connectionTimeout: this.options.commandTimeoutMs,
      maxRetries: 1,
    });
  }

  close(): void {
    this.closed = true;
    for (const fill of this.fills) fill.abort(new Error("Redis cache store is closed."));
    this.client.close();
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Redis cache command deadline exceeded; recreate the store."));
        this.close();
      }, this.options.commandTimeoutMs);
    });
    try {
      const raw = await Promise.race([
        this.client.send("EVAL", [
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
      return JSON.parse(String(raw)) as ScriptResult;
    } finally {
      clearTimeout(timer);
    }
  }
}

export type { RedisCacheOptions };
export default RedisCacheStore;
