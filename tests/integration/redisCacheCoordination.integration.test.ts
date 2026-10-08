import { describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import RedisCacheStore from "../../src/core/cache/redisCacheStore";
import { CacheRepository } from "../../src/core/cache/repository";
import { restoreEnvVar } from "../helpers/restoreEnv";

const redisUrl = process.env.REDIS_URL?.trim() ?? "";
const describeRedis = redisUrl ? describe : describe.skip;
const options = {
  leaseMs: 400,
  fillTimeoutMs: 4000,
  waitTimeoutMs: 6000,
  metadataTtlMs: 5000,
  metadataLimit: 66,
  pollMs: 20,
};

function fixture(ttlMs = 10_000, capacity = 10) {
  const prefix = `cache-coordination-${crypto.randomUUID()}`;
  const previous = process.env.APP_KEY_PREFIX;
  process.env.APP_KEY_PREFIX = prefix;
  const stores: [RedisCacheStore, RedisCacheStore, RedisCacheStore] = [
    new RedisCacheStore(redisUrl, ttlMs, capacity, options),
    new RedisCacheStore(redisUrl, ttlMs, capacity, options),
    new RedisCacheStore(redisUrl, ttlMs, capacity, options),
  ];
  restoreEnvVar("APP_KEY_PREFIX", previous);
  const namespace = `${prefix}:cache:v3:`;
  const slot = new Bun.CryptoHasher("sha256").update(namespace).digest("hex");
  const keys = ["entries", "expiry", "order", "metadata", "metadata-expiry"].map(
    (name) => `${namespace}{${slot}}:${name}`,
  );
  const control = `${prefix}:control`;
  const client = new RedisClient(redisUrl);
  const children: ReturnType<typeof spawn>[] = [];
  return {
    prefix,
    stores,
    keys,
    client,
    control,
    children,
    async close() {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            process.kill(child.pid, "SIGCONT");
            process.kill(child.pid, "SIGKILL");
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
          }
        }
        await child.exited;
      }
      try {
        await stores[0].clear();
        await client.del(
          ...[
            control,
            `${control}:ready`,
            `${control}:start`,
            `${control}:started`,
            `${control}:owner`,
            `${control}:release`,
          ],
        );
      } finally {
        for (const store of stores) store.close();
        client.close();
      }
    },
  };
}

function spawn(prefix: string, control: string, value: string, delay = 0, blocked = false) {
  const script = `
import { RedisClient } from 'bun';
import RedisCacheStore from ${JSON.stringify(new URL("../../src/core/cache/redisCacheStore.ts", import.meta.url).href)};
const redis = new RedisClient(process.env.REDIS_URL);
const control = process.env.CACHE_CONTROL;
const store = new RedisCacheStore(process.env.REDIS_URL, 10000, 10, JSON.parse(process.env.CACHE_OPTIONS));
try {
  await redis.incr(control + ':ready');
  while (!(await redis.get(control + ':start'))) await Bun.sleep(10);
  const value = await store.getOrSetTagged('catalog?user=1', async () => {
    await redis.incr(control + ':started');
    await redis.set(control + ':owner', String(process.pid));
    if (process.env.CACHE_BLOCKED === 'true') while (!(await redis.get(control + ':release'))) await Bun.sleep(10);
    await Bun.sleep(Number(process.env.CACHE_DELAY));
    return process.env.CACHE_VALUE;
  }, ['catalog']);
  console.log(JSON.stringify(value));
} finally { store.close(); redis.close(); }
`;
  return Bun.spawn([process.execPath, "-e", script], {
    env: {
      ...process.env,
      APP_KEY_PREFIX: prefix,
      CACHE_CONTROL: control,
      CACHE_OPTIONS: JSON.stringify(options),
      CACHE_VALUE: value,
      CACHE_DELAY: String(delay),
      CACHE_BLOCKED: String(blocked),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function until(predicate: () => Promise<boolean>) {
  const end = performance.now() + 6000;
  while (!(await predicate())) {
    if (performance.now() > end) throw new Error("Cache process barrier timed out");
    await Bun.sleep(10);
  }
}
async function result(child: ReturnType<typeof spawn>) {
  const [exit, output, errors] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(errors).toBe("");
  expect(exit).toBe(0);
  return JSON.parse(output.trim());
}

describeRedis("bounded shared Redis cache coordination", () => {
  for (const action of ["exact", "prefix", "tag", "clear", "set"] as const) {
    test(`${action} invalidation fences an older in-flight fill`, async () => {
      const f = fixture();
      let release!: () => void;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        const stale = new CacheRepository(f.stores[0])
          .tags("catalog")
          .remember("catalog?user=1", async () => {
            started();
            await gate;
            return "old";
          });
        await ready;
        const other = f.stores[1];
        if (action === "exact") await other.invalidate("catalog?user=1");
        if (action === "prefix") await other.invalidateByPrefix("catalog");
        if (action === "tag") await other.flushTags(["catalog"]);
        if (action === "clear") await other.clear();
        if (action === "set") await other.set("catalog?user=1", "fresh");
        else await other.getOrSetTagged("catalog?user=1", async () => "fresh", ["catalog"]);
        release();
        expect(await stale).toBe("old");
        expect(await f.stores[2].get<string>("catalog?user=1")).toBe("fresh");
      } finally {
        release();
        await f.close();
      }
    });
  }

  test("preserves exact/query-prefix matching, tag unions and unrelated entries", async () => {
    const f = fixture();
    try {
      const [a, b, c] = f.stores;
      await a.set("catalogue", "untouched");
      await a.getOrSetTagged("catalog?x=1", async () => 1, ["one"]);
      await b.getOrSetTagged("catalog?x=1", async () => 2, ["two"]);
      expect(await c.flushTags(["two"])).toBe(1);
      await a.set("catalog", 3);
      await b.set("catalog?x=2", 4);
      expect(await c.invalidateByPrefix("catalog")).toBe(2);
      expect(await a.get<string>("catalogue")).toBe("untouched");
    } finally {
      await f.close();
    }
  });

  test("new tags cannot join a fill started before their invalidation", async () => {
    const f = fixture();
    let release!: () => void;
    let start!: () => void;
    const ready = new Promise<void>((resolve) => {
      start = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const old = f.stores[0].getOrSetTagged("item", async () => {
        start();
        await gate;
        return "old";
      }, ["one"]);
      await ready;
      await f.stores[1].flushTags(["two"]);
      expect(await f.stores[1].getOrSetTagged("item", async () => "fresh", ["two"])).toBe("fresh");
      release();
      await old;
      expect(await f.stores[2].get<string>("item")).toBe("fresh");
      expect(await f.stores[2].flushTags(["one"])).toBe(1);
    } finally {
      release();
      await f.close();
    }
  });

  test("eviction is shared LRU and expiry removes idle physical containers", async () => {
    const f = fixture(350, 2);
    try {
      await f.stores[0].set("a", 1);
      await f.stores[1].set("b", 2);
      await f.stores[2].get("a");
      await f.stores[1].set("c", 3);
      expect(await f.stores[0].get("b")).toBeUndefined();
      expect(await f.stores[2].size()).toBe(2);
      await Bun.sleep(400);
      expect(await f.client.send("EXISTS", f.keys.slice(0, 3))).toBe(0);
    } finally {
      await f.close();
    }
  });

  test("metadata pressure fences pending owners and retains bounded cardinality", async () => {
    const f = fixture(0);
    let start!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      start = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await f.stores[1].set("permanent", 7);
      const old = f.stores[0].getOrSetTagged("item", async () => {
        start();
        await gate;
        return "old";
      }, ["item"]);
      await ready;
      for (let i = 0; i < 150; i++) await f.stores[1].flushTags([`missing-${i}`]);
      expect(Number(await f.client.send("HLEN", [String(f.keys[3])]))).toBeLessThanOrEqual(
        options.metadataLimit,
      );
      expect(Number(await f.client.send("ZCARD", [String(f.keys[4])]))).toBeLessThanOrEqual(
        options.metadataLimit,
      );
      release();
      await old;
      expect(await f.stores[2].get<string>("item")).toBeUndefined();
      expect(await f.stores[2].get<number>("permanent")).toBe(7);
    } finally {
      release();
      await f.close();
    }
  });

  test("three processes share one renewable fill", async () => {
    const f = fixture();
    try {
      f.children.push(
        ...Array.from({ length: 3 }, () => spawn(f.prefix, f.control, "shared", 1300)),
      );
      await until(async () => Number(await f.client.get(`${f.control}:ready`)) === 3);
      await f.client.set(`${f.control}:start`, "1");
      expect(await Promise.all(f.children.map(result))).toEqual(["shared", "shared", "shared"]);
      expect(await f.client.get(`${f.control}:started`)).toBe("1");
    } finally {
      await f.close();
    }
  }, 15_000);

  test("tag invalidation reaches a pending owner and two waiters in separate processes", async () => {
    const f = fixture();
    try {
      const owner = spawn(f.prefix, f.control, "old", 0, true);
      f.children.push(owner);
      await f.client.set(`${f.control}:start`, "1");
      await until(async () => (await f.client.get(`${f.control}:owner`)) === String(owner.pid));
      await f.stores[0].flushTags(["catalog"]);
      const fresh = Array.from({ length: 2 }, () => spawn(f.prefix, f.control, "fresh", 100));
      f.children.push(...fresh);
      expect(await Promise.all(fresh.map(result))).toEqual(["fresh", "fresh"]);
      await f.client.set(`${f.control}:release`, "1");
      expect(await result(owner)).toBe("old");
      expect(await f.stores[1].get<string>("catalog?user=1")).toBe("fresh");
      expect(await f.client.get(`${f.control}:started`)).toBe("2");
    } finally {
      await f.close();
    }
  }, 15_000);

  test("three processes recover a killed owner without manual cleanup", async () => {
    const f = fixture();
    try {
      const owner = spawn(f.prefix, f.control, "old", 0, true);
      f.children.push(owner);
      await f.client.set(`${f.control}:start`, "1");
      await until(async () => (await f.client.get(`${f.control}:owner`)) === String(owner.pid));
      owner.kill("SIGKILL");
      await owner.exited;
      const fresh = Array.from({ length: 2 }, () => spawn(f.prefix, f.control, "fresh"));
      f.children.push(...fresh);
      expect(await Promise.all(fresh.map(result))).toEqual(["fresh", "fresh"]);
      expect(await f.stores[0].get<string>("catalog?user=1")).toBe("fresh");
      expect(await f.client.get(`${f.control}:started`)).toBe("2");
    } finally {
      await f.close();
    }
  }, 15_000);

  test("a paused stale process cannot overwrite or release its successor's lease", async () => {
    const f = fixture();
    try {
      const owner = spawn(f.prefix, f.control, "old", 0, true);
      f.children.push(owner);
      await f.client.set(`${f.control}:start`, "1");
      await until(async () => (await f.client.get(`${f.control}:owner`)) === String(owner.pid));
      process.kill(owner.pid, "SIGSTOP");
      await Bun.sleep(650);
      const fresh = Array.from({ length: 2 }, () => spawn(f.prefix, f.control, "fresh", 1300));
      f.children.push(...fresh);
      await until(async () => Number(await f.client.get(`${f.control}:started`)) === 2);
      await f.client.set(`${f.control}:release`, "1");
      process.kill(owner.pid, "SIGCONT");
      expect(await result(owner)).toBe("old");
      expect(await Promise.all(fresh.map(result))).toEqual(["fresh", "fresh"]);
      expect(await f.client.get(`${f.control}:started`)).toBe("2");
      expect(await f.stores[0].get<string>("catalog?user=1")).toBe("fresh");
    } finally {
      await f.close();
    }
  }, 15_000);

  test("deadline aborts the loader, and ignored cancellation cannot publish later", async () => {
    const f = fixture();
    const previous = process.env.APP_KEY_PREFIX;
    process.env.APP_KEY_PREFIX = f.prefix;
    const store = new RedisCacheStore(redisUrl, 10_000, 10, {
      ...options,
      leaseMs: 40,
      fillTimeoutMs: 120,
    });
    restoreEnvVar("APP_KEY_PREFIX", previous);
    let signal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await expect(
        store.getOrSet("item", async (value) => {
          signal = value;
          await gate;
          return "old";
        }),
      ).rejects.toThrow("fill deadline");
      expect(signal?.aborted).toBe(true);
      expect(await f.stores[1].getOrSet("item", async () => "fresh")).toBe("fresh");
      release();
      await Bun.sleep(30);
      expect(await f.stores[2].get<string>("item")).toBe("fresh");
    } finally {
      release();
      store.close();
      await f.close();
    }
  });

  test("metadata expires independently of permanent data and missing tags retain no entries", async () => {
    const f = fixture(0);
    const previous = process.env.APP_KEY_PREFIX;
    process.env.APP_KEY_PREFIX = f.prefix;
    const store = new RedisCacheStore(redisUrl, 0, 10, {
      ...options,
      leaseMs: 30,
      fillTimeoutMs: 60,
      metadataTtlMs: 100,
    });
    restoreEnvVar("APP_KEY_PREFIX", previous);
    try {
      await store.getOrSetTagged("permanent", async () => 1, ["catalog"]);
      await store.attachTags("missing", ["ghost"]);
      await store.flushTags(["unknown"]);
      await Bun.sleep(150);
      expect(await f.client.send("EXISTS", f.keys.slice(3))).toBe(0);
      expect(await store.get<number>("permanent")).toBe(1);
      expect(await store.flushTags(["catalog"])).toBe(1);
      expect(await store.flushTags(["ghost"])).toBe(0);
    } finally {
      store.close();
      await f.close();
    }
  });

  test("loader failure releases ownership and close aborts active fills", async () => {
    const f = fixture();
    try {
      await expect(
        f.stores[0].getOrSet("item", async () => {
          throw new Error("loader failed");
        }),
      ).rejects.toThrow("loader failed");
      expect(await f.stores[1].getOrSet("item", async () => 2)).toBe(2);
      let start!: () => void;
      const ready = new Promise<void>((resolve) => {
        start = resolve;
      });
      let signal: AbortSignal | undefined;
      const pending = f.stores[0].getOrSet("other", async (value) => {
        signal = value;
        start();
        return new Promise<never>(() => {});
      });
      const rejected = pending.catch((error) => error);
      await ready;
      f.stores[0].close();
      expect((await rejected).message).toContain("closed");
      expect(signal?.aborted).toBe(true);
      await expect(f.stores[0].get("item")).rejects.toThrow("closed");
    } finally {
      await f.stores[1].clear();
      for (const store of f.stores) store.close();
      f.client.close();
    }
  });

  test("Redis unavailability rejects without invoking a process-local loader", async () => {
    const store = new RedisCacheStore("redis://127.0.0.1:1", 1000, 10, { commandTimeoutMs: 150 });
    let called = false;
    const started = performance.now();
    try {
      await expect(
        store.getOrSet("item", async () => {
          called = true;
          return 1;
        }),
      ).rejects.toThrow();
      expect(called).toBe(false);
      expect(performance.now() - started).toBeLessThan(2000);
    } finally {
      store.close();
    }
  });

  test("a nonresponding Redis connection hits its command deadline and closes the store", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const store = new RedisCacheStore(`redis://127.0.0.1:${server.port}`, 1000, 10, {
      commandTimeoutMs: 120,
    });
    try {
      await expect(store.get("item")).rejects.toThrow("command deadline");
      await expect(store.get("item")).rejects.toThrow("closed");
    } finally {
      store.close();
      server.stop(true);
    }
  });

  test("losing an index container conservatively discards orphaned values", async () => {
    const f = fixture();
    try {
      await f.stores[0].set("item", "orphan");
      await f.client.del(String(f.keys[1]));
      expect(await f.stores[1].get("item")).toBeUndefined();
      expect(await f.stores[1].size()).toBe(0);
    } finally {
      await f.close();
    }
  });

  test("unexpected Redis key types fail before altering cache data", async () => {
    const f = fixture();
    try {
      await f.stores[0].set("item", "preserved");
      await f.client.del(String(f.keys[3]));
      await f.client.set(String(f.keys[3]), "wrong-type");
      await expect(f.stores[1].invalidate("item")).rejects.toThrow("Unexpected cache key type");
      await f.client.del(String(f.keys[3]));
      expect(await f.stores[2].get<string>("item")).toBe("preserved");
    } finally {
      await f.close();
    }
  });

  test("cache operations work when Redis ACL forbids keyspace enumeration", async () => {
    const f = fixture();
    const user = `cache-${crypto.randomUUID()}`;
    const password = crypto.randomUUID();
    const url = new URL(redisUrl);
    url.username = user;
    url.password = password;
    let restricted: RedisCacheStore | undefined;
    try {
      await f.client.send("ACL", [
        "SETUSER",
        user,
        "on",
        `>${password}`,
        `~${f.prefix}:*`,
        "+@all",
        "-keys",
        "-scan",
      ]);
      const previous = process.env.APP_KEY_PREFIX;
      process.env.APP_KEY_PREFIX = f.prefix;
      restricted = new RedisCacheStore(url.href, 1000, 10, options);
      restoreEnvVar("APP_KEY_PREFIX", previous);
      await restricted.getOrSetTagged("item", async () => 1, ["catalog"]);
      expect(await restricted.get<number>("item")).toBe(1);
      expect(await restricted.size()).toBe(1);
      expect(await restricted.flushTags(["catalog"])).toBe(1);
      await restricted.set("other?x=1", 2);
      expect(await restricted.invalidateByPrefix("other")).toBe(1);
      await restricted.clear();
    } finally {
      restricted?.close();
      await f.client.send("ACL", ["DELUSER", user]);
      await f.close();
    }
  });

  test("invalid TTL rejects before invoking business code", async () => {
    const f = fixture();
    let called = false;
    try {
      await expect(
        f.stores[0].getOrSet(
          "item",
          async () => {
            called = true;
            return 1;
          },
          -1,
        ),
      ).rejects.toThrow("ttlMs");
      expect(called).toBe(false);
    } finally {
      await f.close();
    }
  });
});
