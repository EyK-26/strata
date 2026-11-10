import { test } from "bun:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { createCachedJson } from "@getstrata/bootstrap/cachedJson";
import {
  type CacheBindingOptions,
  createCacheBindings,
} from "@getstrata/bootstrap/providers/cache";
import { CacheRepository, createGuardedCache } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { CORE_CACHE_BACKEND_TOKEN, CORE_CACHE_TOKEN } from "@getstrata/core/cache/tokens";
import type { ExecutionOperations } from "@getstrata/core/contracts/executionOperations";
import { resourceService, valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { type CommandScope, createApplication } from "@getstrata/core/runtime/application";
import { bounded, deferred, pending, rejected } from "../fixtures/applicationOwnershipSupport";

const options = (): CacheBindingOptions => ({
  driver: "array",
  ttlMs: 60000,
  maxEntries: 16,
  namespace: "independent:array:cache:v3:",
});
function expired(error: unknown) {
  assert.ok(error instanceof Error);
  assert.equal(Reflect.get(error, "code"), "APPLICATION_SCOPE_EXPIRED");
}
function turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

class ObservedStore extends SimpleCacheStore {
  closes = 0;
  taggedCalls = 0;
  constructor(readonly values = new SimpleCache()) {
    super(values);
  }
  close() {
    this.closes++;
  }
  override getOrSetTagged<T>(
    key: string,
    loader: () => Promise<T>,
    tags: string[],
    ttlMs?: number,
  ): Promise<T> {
    this.taggedCalls++;
    return super.getOrSetTagged(key, loader, tags, ttlMs);
  }
}

test("canonical cache binding declarations validate one immutable snapshot before effects", async () => {
  const original = {
    driver: "array" as "array" | "redis",
    ttlMs: 60000,
    maxEntries: 8,
    namespace: " snapshot bytes ",
    redisUrl: undefined,
    redis: undefined,
  };
  const declarations = createCacheBindings(original);
  assert.equal(Object.isFrozen(declarations), true);
  assert.equal(declarations.length, 2);
  assert.equal(declarations[0].kind, "resource");
  assert.equal(declarations[0].lifetime, "application");
  assert.equal(declarations[1].kind, "factory");
  assert.equal(declarations[1].lifetime, "execution");
  original.driver = "redis";
  original.namespace = "";
  original.ttlMs = -1;
  original.maxEntries = 0;
  const app = createApplication({ providers: [], services: declarations });
  try {
    const started = await app.start().then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    );
    assert.equal(
      started.ok,
      true,
      "canonical cache declarations capture validated options before caller mutation",
    );
    assert.equal(
      await app.run((scope) => scope.resolve(CORE_CACHE_TOKEN).remember("key", async () => 7)),
      7,
    );
  } finally {
    await app.stop();
  }
  for (const invalid of [
    { ...options(), driver: "unknown" },
    { ...options(), ttlMs: -1 },
    { ...options(), maxEntries: 0 },
    { ...options(), namespace: "" },
    { ...options(), namespace: undefined },
    { ...options(), driver: "redis", redisUrl: undefined },
  ])
    assert.throws(() => createCacheBindings(invalid as CacheBindingOptions));
  let namespaceReads = 0;
  const unstable = new Proxy(
    { driver: "array", ttlMs: 100, maxEntries: 2 },
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === "namespace") {
          namespaceReads++;
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: "appeared after snapshot",
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  assert.throws(
    () => createCacheBindings(unstable as unknown as CacheBindingOptions),
    "canonical explicit namespace must be present in the copied snapshot",
  );
  assert.equal(
    namespaceReads,
    0,
    "canonical namespace validation never rereads caller descriptors after snapshot",
  );
});

test("guarded cache owns every async method once while hits and aliases do not elect extra loaders", async () => {
  const store = new ObservedStore();
  const backend = new CacheRepository(store);
  let admissions = 0;
  let assertions = 0;
  const operations: ExecutionOperations = {
    assertActive() {
      assertions++;
    },
    operation(work) {
      admissions++;
      const result = Promise.resolve().then(work);
      void result.catch(() => {});
      return result;
    },
  };
  const cache = createGuardedCache(backend, operations);
  assert.equal(Object.isFrozen(cache), true);
  assert.equal("close" in cache, false);
  assert.equal("store" in cache, false);
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["get", () => cache.get("key")],
    ["remember hit", () => cache.remember("key", async () => "unexpected")],
    ["getOrSet hit", () => cache.getOrSet("key", async () => "unexpected")],
    ["size", () => cache.size()],
    ["forget", () => cache.forget("key")],
    ["invalidate", () => cache.invalidate("key")],
    ["invalidateByPrefix", () => cache.invalidateByPrefix("key")],
    ["flush", () => cache.flush()],
    ["clear", () => cache.clear()],
  ];
  for (const [name, call] of calls) {
    store.values.set("key", 7);
    const before = admissions;
    await call();
    assert.equal(admissions - before, 1, `${name} reserves exactly one operation`);
  }
  const beforeTags = admissions;
  const tagged = cache.tags("tag");
  assert.equal(admissions, beforeTags, "tags construction reserves no asynchronous work");
  assert.ok(assertions > 0);
  assert.equal(Object.isFrozen(tagged), true);
  store.values.set("tagged", 9);
  let unexpected = 0;
  await tagged.remember("tagged", async () => {
    unexpected++;
    return 10;
  });
  assert.equal(admissions, beforeTags + 1);
  assert.equal(await tagged.flush(), 1);
  assert.equal(admissions, beforeTags + 2);
  assert.equal(unexpected, 0);
  const beforeMiss = admissions;
  assert.equal(await cache.remember("miss", async () => 11), 11);
  assert.equal(
    admissions - beforeMiss,
    2,
    "one miss reserves store operation and exactly one actual loader child",
  );
  await backend.close();
});

for (const method of ["get", "clear"] as const) {
  test(`unawaited cache ${method} holds execution and backend until actual I/O settles`, async () => {
    const entered = deferred();
    const release = deferred();
    class GatedStore extends ObservedStore {
      override get<T>(key: string): Promise<T | undefined> {
        if (method !== "get") return super.get<T>(key);
        entered.resolve();
        return release.promise.then(() => super.get<T>(key));
      }
      override clear(): Promise<void> {
        if (method !== "clear") return super.clear();
        entered.resolve();
        return release.promise.then(() => super.clear());
      }
    }
    const store = new GatedStore();
    const backend = new CacheRepository(store);
    const app = createApplication({
      shutdownTimeoutMs: 20,
      providers: [],
      services: createCacheBindings(options()),
      overrides: [
        resourceService(CORE_CACHE_BACKEND_TOKEN, {
          lifetime: "application",
          dependencies: [],
          create: () => ({
            name: "controlled backend",
            open: () => ({ ok: true, value: backend }),
            close(value) {
              return value.close();
            },
          }),
        }),
      ],
    });
    await app.start();
    const run = app.run((scope) => {
      const cache = scope.resolve(CORE_CACHE_TOKEN);
      if (method === "get") void cache.get("key");
      else void cache.clear();
      return 7;
    });
    try {
      await bounded(entered.promise);
      await pending(run);
      const stop = await bounded(app.stop());
      assert.equal(stop.timedOut, true);
      assert.equal(
        store.closes,
        0,
        "unawaited async cache operation keeps backend open through bounded shutdown",
      );
      release.resolve();
      assert.equal(await bounded(run), 7);
      assert.equal((await bounded(app.completion)).successful, true);
      assert.equal(store.closes, 1, "backend closes once after actual cache operation drain");
    } finally {
      release.resolve();
      await app.stop();
    }
  });
}

test("shared execution cache and tags use current child lease and reject stale or wrong-run authority", async () => {
  const app = createApplication({ providers: [], services: createCacheBindings(options()) });
  await app.start();
  const childEntered = deferred();
  const childRelease = deferred();
  let saved!: ReturnType<typeof createGuardedCache>;
  let tags!: ReturnType<typeof saved.tags>;
  let root!: CommandScope;
  let childValue: unknown;
  let childSame = false;
  let unexpected = 0;
  const run = app.run((scope) => {
    root = scope;
    saved = scope.resolve(CORE_CACHE_TOKEN);
    tags = saved.tags("tag");
    void scope.spawn(async (child) => {
      childEntered.resolve();
      await childRelease.promise;
      childSame = child.resolve(CORE_CACHE_TOKEN) === saved;
      childValue = await tags.remember("key", async () => 7);
    });
    return 9;
  });
  try {
    await bounded(childEntered.promise);
    await pending(run);
    let hit!: Promise<unknown>;
    assert.doesNotThrow(() => {
      hit = saved.get("key");
    });
    expired(await rejected(hit));
    expired(
      await rejected(
        tags.remember("stale", async () => {
          unexpected++;
          return 1;
        }),
      ),
    );
    assert.throws(
      () => saved.tags("stale"),
      (error: unknown) => {
        expired(error);
        return true;
      },
    );
    assert.throws(
      () => root.resolve(CORE_CACHE_TOKEN),
      (error: unknown) => {
        expired(error);
        return true;
      },
    );
    childRelease.resolve();
    assert.equal(await bounded(run), 9);
    assert.equal(childSame, true);
    assert.equal(
      childValue,
      7,
      "root-created tags remain usable by active child of the same execution",
    );
    const mismatched = await app.run(async (scope) => {
      const fresh = scope.resolve(CORE_CACHE_TOKEN);
      const errors = [await rejected(saved.get("key")), await rejected(tags.flush())];
      return { distinct: fresh !== saved, errors, value: await fresh.get("key") };
    });
    assert.equal(mismatched.distinct, true);
    mismatched.errors.forEach(expired);
    assert.equal(mismatched.value, 7);
    assert.equal(unexpected, 0);
  } finally {
    childRelease.resolve();
    await app.stop();
  }
});

test("array clear and successor fill retain actual loader owner and fence old publication and finalization", async () => {
  const Resource = createServiceToken<{ live: boolean }>("loader execution resource");
  const app = createApplication({
    providers: [],
    services: [
      ...createCacheBindings(options()),
      resourceService(Resource, {
        lifetime: "execution",
        dependencies: [],
        create: () => ({
          name: "execution resource",
          open: () => ({ ok: true, value: { live: true } }),
          close(value) {
            value.live = false;
          },
        }),
      }),
    ],
  });
  await app.start();
  const oldEntered = deferred();
  const oldRelease = deferred();
  const nextEntered = deferred();
  const nextRelease = deferred();
  let firstResource!: { live: boolean };
  let secondResource!: { live: boolean };
  let nested: { ok: boolean; value?: number; error?: unknown } | undefined;
  let oldWaiter!: Promise<string>;
  let nextWaiter!: Promise<string>;
  let dedupWaiter!: Promise<string>;
  let oldScope!: CommandScope;
  let oldLoads = 0;
  let nextLoads = 0;
  let dedupLoads = 0;
  let thirdLoads = 0;
  let visible: unknown;
  const first = app.run((scope) => {
    oldScope = scope;
    firstResource = scope.resolve(Resource);
    const cache = scope.resolve(CORE_CACHE_TOKEN);
    oldWaiter = cache.remember("key", async () => {
      oldLoads++;
      oldEntered.resolve();
      await oldRelease.promise;
      nested = await cache.size().then(
        (value) => ({ ok: true, value }),
        (error: unknown) => ({ ok: false, error }),
      );
      return "old";
    });
    return 7;
  });
  let second: Promise<number> | undefined;
  let third: Promise<string> | undefined;
  try {
    await turn();
    await pending(first);
    await bounded(oldEntered.promise);
    second = app.run(async (scope) => {
      secondResource = scope.resolve(Resource);
      const cache = scope.resolve(CORE_CACHE_TOKEN);
      await cache.clear();
      nextWaiter = cache.remember("key", async () => {
        nextLoads++;
        nextEntered.resolve();
        await nextRelease.promise;
        return "new";
      });
      dedupWaiter = cache.remember("key", async () => {
        dedupLoads++;
        return "wrong";
      });
      return 9;
    });
    await bounded(nextEntered.promise);
    assert.equal(
      firstResource.live,
      true,
      "clearing algorithm inflight state never releases actual loader execution resource",
    );
    assert.throws(
      () => oldScope.resolve(Resource),
      (error: unknown) => {
        expired(error);
        return true;
      },
    );
    oldRelease.resolve();
    assert.equal(await bounded(first), 7);
    assert.equal(await bounded(oldWaiter), "old");
    assert.equal(
      nested?.ok,
      true,
      "actual loader keeps legal nested cache authority after initiating root returns",
    );
    assert.equal(firstResource.live, false);
    assert.equal(secondResource.live, true);
    third = app.run(async (scope) => {
      const cache = scope.resolve(CORE_CACHE_TOKEN);
      visible = await cache.get("key");
      return cache.remember("key", async () => {
        thirdLoads++;
        return "third";
      });
    });
    await turn();
    assert.equal(
      visible,
      undefined,
      "old cleared fill never republishes while successor is pending",
    );
    assert.equal(thirdLoads, 0, "old fill finally cannot erase successor dedup registration");
    await pending(third);
    nextRelease.resolve();
    assert.equal(await bounded(second), 9);
    assert.equal(await bounded(third), "new");
    assert.equal(await bounded(nextWaiter), "new");
    assert.equal(await bounded(dedupWaiter), "new");
    assert.equal(oldLoads, 1);
    assert.equal(nextLoads, 1);
    assert.equal(dedupLoads, 0);
    assert.equal(await app.run((scope) => scope.resolve(CORE_CACHE_TOKEN).get("key")), "new");
  } finally {
    oldRelease.resolve();
    nextRelease.resolve();
    await app.stop();
  }
});

test("canonical cachedJson uses overridden backend and copied explicit policy through tags and recovery", async () => {
  const store = new ObservedStore();
  const backend = new CacheRepository(store);
  const app = createApplication({
    providers: [],
    services: createCacheBindings(options()),
    overrides: [valueService(CORE_CACHE_BACKEND_TOKEN, backend)],
  });
  const entered = deferred();
  const release = deferred();
  const policy = { etagEnabled: true };
  const marker = Symbol("ordinary loader error");
  const previous = process.env.FEATURE_ETAG;
  let loads = 0;
  let unexpected = 0;
  await app.start();
  const run = app.run(async (scope) => {
    const cache = scope.resolve(CORE_CACHE_TOKEN);
    const helper = createCachedJson(cache, policy);
    const request = new Request("http://cache.test/json");
    const pendingResponse = helper(
      "json",
      async () => {
        loads++;
        entered.resolve();
        await release.promise;
        return { version: 1 };
      },
      ["tag"],
      request,
    );
    const response = await pendingResponse;
    const conditional = await helper(
      "json",
      async () => {
        unexpected++;
        return { version: 99 };
      },
      ["tag"],
      new Request("http://cache.test/json", {
        headers: { "If-None-Match": response.headers.get("etag") ?? "missing" },
      }),
    );
    const plain = await helper("json", async () => {
      unexpected++;
      return {};
    });
    const removed = await cache.tags("tag").flush();
    const reloaded = await helper(
      "json",
      async () => {
        loads++;
        return { version: 2 };
      },
      ["tag"],
      request,
    );
    const failed = await helper("failure", async () => {
      loads++;
      throw marker;
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    return { response, conditional, plain, removed, reloaded, failed };
  });
  try {
    await bounded(entered.promise);
    policy.etagEnabled = false;
    process.env.FEATURE_ETAG = "false";
    release.resolve();
    const result = await bounded(run);
    assert.equal(result.response.status, 200);
    assert.ok(
      result.response.headers.get("etag"),
      "canonical cachedJson retains copied policy despite env and caller mutation",
    );
    assert.equal(result.response.headers.get("cache-control"), "private, must-revalidate");
    const vary = result.response.headers.get("vary") ?? "";
    assert.match(vary, /Authorization/i);
    assert.match(vary, /X-Tenant-Id/i);
    assert.equal(result.conditional.status, 304);
    assert.equal(await result.conditional.text(), "");
    assert.equal(result.plain.status, 200);
    assert.equal(result.plain.headers.get("etag"), null);
    assert.equal(result.removed, 1);
    assert.deepEqual(await result.reloaded.json(), { version: 2 });
    assert.equal(result.failed.ok, false);
    if (!result.failed.ok) assert.equal(result.failed.error, marker);
    assert.equal(loads, 3);
    assert.equal(unexpected, 0);
    assert.ok(store.taggedCalls >= 3, "canonical helper uses actual overridden cache backend");
    assert.equal(Object.isFrozen(policy), false);
    assert.equal(
      (await app.stop()).successful,
      true,
      "caught ordinary cache loader failure remains recoverable through O and L",
    );
    assert.equal(
      store.closes,
      0,
      "value override stays caller-owned instead of implicitly adopted",
    );
  } finally {
    release.resolve();
    if (previous === undefined) delete process.env.FEATURE_ETAG;
    else process.env.FEATURE_ETAG = previous;
    await app.stop();
    await backend.close();
  }
});

test("cachedJson rejects malformed policy without executing accessors or using ambient defaults", () => {
  const backend = new CacheRepository(new SimpleCacheStore(new SimpleCache()));
  let reads = 0;
  const accessor = Object.defineProperty({}, "etagEnabled", {
    get() {
      reads++;
      return true;
    },
  });
  assert.throws(() => createCachedJson(backend, accessor as { etagEnabled: boolean }), TypeError);
  assert.throws(() => createCachedJson(backend, { etagEnabled: "true" } as never), TypeError);
  assert.equal(reads, 0, "response policy validation never invokes caller getter");
});

test("ignored CacheLike methods observe actual returned ordinary and stale rejection promises", async () => {
  const sourceRoot = realpathSync(join(import.meta.dir, "../.."));
  const sourcePaths = [
    "src/core/runtime/application.ts",
    "src/bootstrap/providers/cache.ts",
    "src/core/cache/tokens.ts",
    "src/core/cache/repository.ts",
  ].map((path) => realpathSync(join(sourceRoot, path)));
  // Plain Bun owns unhandled rejection observation; bun:test consumes it before listeners.
  // Paths derive from THIS test's current tree, including disposable mutation stages.
  const program = `
    import { realpathSync } from "node:fs";
    import { createApplication } from ${JSON.stringify(sourcePaths[0])};
    import { createCacheBindings } from ${JSON.stringify(sourcePaths[1])};
    import { CORE_CACHE_TOKEN } from ${JSON.stringify(sourcePaths[2])};
    const sourcePaths = [
      import.meta.resolve(${JSON.stringify(sourcePaths[0])}),
      import.meta.resolve(${JSON.stringify(sourcePaths[1])}),
      import.meta.resolve(${JSON.stringify(sourcePaths[2])}),
      import.meta.resolve("@getstrata/core/cache/repository"),
    ].map((path) => realpathSync(new URL(path)));
    const unhandled = [];
    process.on("unhandledRejection", (error) => { unhandled.push(error); });
    const turn = () => new Promise((resolve) => setImmediate(resolve));
    const app = createApplication({ providers: [], services: createCacheBindings({
      driver: "array", ttlMs: 60000, maxEntries: 4, namespace: "plain-consumer:owned:"
    }) });
    let saved;
    let result;
    try {
      await app.start();
      result = await app.run((scope) => {
        saved = scope.resolve(CORE_CACHE_TOKEN);
        void saved.remember("ignored", async () => { throw undefined; });
        return 7;
      });
      await turn();
      void saved.get("stale hit");
      await turn(); await turn();
    } finally { await app.stop(); }
    await turn();
    console.log(JSON.stringify({ result, unhandled: unhandled.length,
      sourceRoot: realpathSync(process.cwd()), sourcePaths }));
  `;
  const childEnv = { ...process.env };
  delete childEnv.BUN_OPTIONS;
  delete childEnv.NODE_OPTIONS;
  const child = Bun.spawn([process.execPath, "--eval", program], {
    cwd: sourceRoot,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(exit, 0, `Plain source consumer failed: ${stderr}`);
  const report = JSON.parse(stdout.trim());
  assert.equal(report.sourceRoot, sourceRoot);
  assert.deepEqual(
    report.sourcePaths,
    sourcePaths,
    "plain cache consumer imports this exact source and mutation stage",
  );
  assert.equal(report.result, 7);
  assert.equal(
    report.unhandled,
    0,
    "CacheLike returns the actual observed operation promise without an unobserved async wrapper",
  );
});

test("controlled backend waiter deadline keeps actual loader owned after waiter and root body settle", async () => {
  const timeout = Symbol("controlled waiter deadline");
  const waiterDeadline = deferred();
  const loaderEntered = deferred();
  const loaderContinue = deferred();
  const nestedEntered = deferred();
  const loaderRelease = deferred();
  const rootReturned = deferred();
  const events: string[] = [];
  class ControlledWaiterStore extends ObservedStore {
    override getOrSet<T>(_key: string, loader: () => Promise<T>): Promise<T> {
      // Controlled backend waiter race only; native Redis deadline behavior is tested separately.
      const actual = loader();
      void actual.catch(() => {});
      return waiterDeadline.promise.then(() => {
        throw timeout;
      });
    }
    override close() {
      super.close();
      events.push("backend.close");
    }
  }
  const store = new ControlledWaiterStore();
  const backend = new CacheRepository(store);
  const Resource = createServiceToken<{ live: boolean }>("controlled loader execution resource");
  const app = createApplication({
    shutdownTimeoutMs: 20,
    providers: [],
    services: [
      ...createCacheBindings(options()),
      resourceService(Resource, {
        lifetime: "execution",
        dependencies: [CORE_CACHE_BACKEND_TOKEN],
        create: () => ({
          name: "loader resource",
          open: () => ({ ok: true, value: { live: true } }),
          close(value) {
            value.live = false;
            events.push("execution.close");
          },
        }),
      }),
    ],
    overrides: [
      resourceService(CORE_CACHE_BACKEND_TOKEN, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          name: "controlled backend",
          open: () => ({ ok: true, value: backend }),
          close(value) {
            return value.close();
          },
        }),
      }),
    ],
  });
  let captured!: { live: boolean };
  let root!: CommandScope;
  let waiterError: unknown;
  let nested: { ok: boolean; error?: unknown } | undefined;
  let liveInLoader = false;
  await app.start();
  const run = app.run(async (scope) => {
    root = scope;
    captured = scope.resolve(Resource);
    const cache = scope.resolve(CORE_CACHE_TOKEN);
    await cache
      .remember("controlled", async () => {
        loaderEntered.resolve();
        await loaderContinue.promise;
        liveInLoader = captured.live;
        nested = await cache.size().then(
          () => ({ ok: true }),
          (error: unknown) => ({ ok: false, error }),
        );
        nestedEntered.resolve();
        await loaderRelease.promise;
        return 9;
      })
      .catch((error: unknown) => {
        waiterError = error;
      });
    rootReturned.resolve();
    return 7;
  });
  try {
    await bounded(loaderEntered.promise);
    waiterDeadline.resolve();
    await bounded(rootReturned.promise);
    await turn();
    assert.equal(waiterError, timeout);
    assert.equal(
      captured.live,
      true,
      "controlled waiter timeout cannot close execution resource beneath actual pending loader",
    );
    await pending(run);
    assert.throws(
      () => root.resolve(Resource),
      (error: unknown) => {
        expired(error);
        return true;
      },
    );
    loaderContinue.resolve();
    await bounded(nestedEntered.promise);
    assert.equal(liveInLoader, true);
    assert.equal(
      nested?.ok,
      true,
      "actual loader retains its own active frame after waiter and root leases close",
    );
    const stop = await bounded(app.stop());
    assert.equal(stop.timedOut, true);
    assert.equal(
      store.closes,
      0,
      "controlled waiter settlement never authorizes backend close under actual loader",
    );
    assert.equal(captured.live, true);
    await pending(app.completion);
    loaderRelease.resolve();
    assert.equal(await bounded(run), 7);
    assert.equal((await bounded(app.completion)).successful, true);
    assert.deepEqual(
      events,
      ["execution.close", "backend.close"],
      "actual loader drains before execution and backend release",
    );
  } finally {
    waiterDeadline.resolve();
    loaderContinue.resolve();
    loaderRelease.resolve();
    await app.stop();
  }
});
