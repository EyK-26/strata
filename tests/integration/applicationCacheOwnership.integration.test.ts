import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCacheBindings } from "@getstrata/bootstrap/providers/cache";
import { createServiceToken, resourceService, service } from "@getstrata/core";
import type { CacheRepository } from "@getstrata/core/cache/repository";
import { CORE_CACHE_BACKEND_TOKEN, CORE_CACHE_TOKEN } from "@getstrata/core/cache/tokens";
import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
import { createApplication } from "@getstrata/core/runtime/application";

const redisUrl = process.env.REDIS_URL?.trim() ?? "";
const redis = redisUrl ? describe : describe.skip;
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const options = (namespace = `m23:${randomUUID()}:`) => ({
  driver: "redis" as const,
  redisUrl,
  namespace,
  ttlMs: 60000,
  maxEntries: 50,
  redis: { leaseMs: 60, fillTimeoutMs: 150, waitTimeoutMs: 1000, pollMs: 5, metadataTtlMs: 2000 },
});

redis("application-owned real Redis cache", () => {
  test("timed-out waiter retains actual loader, nested authority and backend until real drain", async () => {
    const started = deferred();
    const nested = deferred();
    const nestedDone = deferred();
    const release = deferred();
    const events: string[] = [];
    let backend!: CacheRepository;
    let nestedValue: unknown;
    let nestedError: unknown;
    let nestedHit: unknown;
    let nestedFlushed: unknown;
    let loaderSignal: AbortSignal | undefined;
    let waiterError: unknown;
    let runSettled = false;
    let runOutcome: { ok: true; value: unknown } | { ok: false; error: unknown } | undefined;
    let retainedUseAfterTimeout: unknown;
    let retainedUseAfterStop: unknown;
    let rootReturned = false;
    const Handle = createServiceToken<{ closed: boolean; read: () => string }>(
      "native retained execution",
    );
    const Watch = createServiceToken<boolean>("native backend close witness");
    const settings = options();
    const app = createApplication({
      providers: [],
      shutdownTimeoutMs: 30,
      services: [
        ...createCacheBindings(settings),
        service(Watch, {
          lifetime: "application",
          dependencies: [CORE_CACHE_BACKEND_TOKEN],
          create(value) {
            backend = value;
            const close = value.close.bind(value);
            value.close = async () => {
              events.push("backend.close");
              await close();
            };
            return true;
          },
        }),
        resourceService(Handle, {
          lifetime: "execution",
          dependencies: [],
          create: () => {
            const handle = {
              closed: false,
              read() {
                if (this.closed) throw new Error("retained execution handle already closed");
                return "handle-alive";
              },
            };
            return {
              name: "native retained execution",
              open: () => {
                events.push("execution.open");
                return { ok: true, value: handle };
              },
              close: () => {
                handle.closed = true;
                events.push("execution.close");
              },
            };
          },
        }),
      ],
    });
    let running: Promise<unknown> | undefined;
    try {
      await app.start();
      running = app
        .run((scope) => {
          const handle = scope.resolve(Handle);
          scope.resolve(Watch);
          const cache = scope.resolve(CORE_CACHE_TOKEN);
          void cache
            .remember("slow", async (signal) => {
              loaderSignal = signal;
              events.push("loader.start");
              started.resolve();
              await nested.promise;
              try {
                retainedUseAfterTimeout = handle.read();
                nestedValue = await cache
                  .tags("nested-tag")
                  .remember("nested", async () => "nested-value");
                nestedHit = await cache.get("nested");
                nestedFlushed = await cache.tags("nested-tag").flush();
                events.push("loader.nested");
              } catch (error) {
                nestedError = error;
              } finally {
                nestedDone.resolve();
              }
              await release.promise;
              retainedUseAfterStop = handle.read();
              events.push("loader.end");
              return "late-value";
            })
            .catch((error) => {
              waiterError = error;
              events.push("waiter.rejected");
            });
          rootReturned = true;
        })
        .then(
          (value) => {
            runSettled = true;
            runOutcome = { ok: true, value };
          },
          (error) => {
            runSettled = true;
            runOutcome = { ok: false, error };
          },
        );
      await started.promise;
      // Wait for the store's actual fill timeout, not an invented cancellation of the loader.
      while (waiterError === undefined) await turn();
      assert.equal(rootReturned, true);
      assert.equal(
        runSettled,
        false,
        "actual loader must remain in the execution tree after O settles",
      );
      assert.equal(loaderSignal?.aborted, true);
      assert.deepEqual(events, ["execution.open", "loader.start", "waiter.rejected"]);
      nested.resolve();
      await nestedDone.promise;
      assert.equal(
        nestedError,
        undefined,
        "live loader nested operations must remain legal after waiter timeout",
      );
      assert.equal(
        retainedUseAfterTimeout,
        "handle-alive",
        "captured execution resource remains usable after store timeout",
      );
      assert.equal(nestedHit, "nested-value");
      assert.equal(nestedFlushed, 1);
      assert.equal(
        nestedValue,
        "nested-value",
        "L keeps active facade authority after root and O bodies close",
      );
      assert.equal(await backend.get("slow"), undefined, "timed-out fill cannot publish");
      const stop = await app.stop();
      assert.equal(stop.timedOut, true);
      assert.equal(runSettled, false);
      assert.equal(events.includes("execution.close"), false);
      assert.equal(
        events.includes("backend.close"),
        false,
        "backend close must await actual loader drainage",
      );
      release.resolve();
      await running;
      assert.deepEqual(
        runOutcome,
        { ok: true, value: undefined },
        "actual loader run succeeds after timeout recovery and shutdown observation",
      );
      assert.equal(
        retainedUseAfterStop,
        "handle-alive",
        "actual loader keeps its captured resource until its body ends",
      );
      const completion = await app.completion;
      assert.equal(completion.successful, true);
      assert.deepEqual(events.slice(-3), ["loader.end", "execution.close", "backend.close"]);
    } finally {
      nested.resolve();
      release.resolve();
      await running;
      if (backend && !events.includes("backend.close")) await backend.flush();
      await app.stop();
      await app.completion;
      // A new owned client clears only this test's namespace after the closed backend drains.
      const clean = createApplication({ providers: [], services: createCacheBindings(settings) });
      await clean.start();
      try {
        await clean.run((scope) => scope.resolve(CORE_CACHE_TOKEN).clear());
      } finally {
        await clean.stop();
      }
    }
  }, 10000);

  test("binding namespace and tuning snapshots isolate disjoint clients while shared clients invalidate", async () => {
    const oldPrefix = process.env.APP_KEY_PREFIX;
    const mutable = options();
    mutable.namespace = ` ${mutable.namespace} `;
    const namespace = mutable.namespace;
    const declarations = createCacheBindings(mutable);
    mutable.namespace = `m23:mutated:${randomUUID()}:`;
    mutable.redis.fillTimeoutMs = 1;
    const a = createApplication({ providers: [], services: declarations });
    const b = createApplication({
      providers: [],
      services: createCacheBindings(options(namespace)),
    });
    const c = createApplication({
      providers: [],
      services: createCacheBindings(options(namespace.trim())),
    });
    try {
      process.env.APP_KEY_PREFIX = `m23:ambient-a:${randomUUID()}`;
      await a.start();
      process.env.APP_KEY_PREFIX = `m23:ambient-b:${randomUUID()}`;
      await b.start();
      process.env.APP_KEY_PREFIX = `m23:ambient-c:${randomUUID()}`;
      await c.start();
      const first = await a.run((s) =>
        s
          .resolve(CORE_CACHE_TOKEN)
          .tags("shared")
          .remember("key", async () => "original"),
      );
      const shared = await b.run((s) => s.resolve(CORE_CACHE_TOKEN).get("key"));
      const isolated = await c.run((s) => s.resolve(CORE_CACHE_TOKEN).get("key"));
      assert.equal(first, "original");
      assert.equal(shared, "original");
      assert.equal(isolated, undefined);
      await c.run((s) => s.resolve(CORE_CACHE_TOKEN).remember("key", async () => "separate"));
      await b.run((s) => s.resolve(CORE_CACHE_TOKEN).tags("shared").flush());
      assert.equal(await a.run((s) => s.resolve(CORE_CACHE_TOKEN).get("key")), undefined);
      assert.equal(await c.run((s) => s.resolve(CORE_CACHE_TOKEN).get("key")), "separate");
    } finally {
      if (oldPrefix === undefined) delete process.env.APP_KEY_PREFIX;
      else process.env.APP_KEY_PREFIX = oldPrefix;
      for (const app of [a, b, c]) {
        if (app.state.phase === "ready") await app.run((s) => s.resolve(CORE_CACHE_TOKEN).clear());
        await app.stop();
      }
    }
  }, 10000);

  test("dedup keeps the electing execution owner and clear fences old publication and successor cleanup", async () => {
    const settings = options();
    settings.redis.fillTimeoutMs = 2000;
    settings.redis.metadataTtlMs = 4000;
    const dedupRelease = deferred();
    const entered = deferred();
    const oldEntered = deferred();
    const oldRelease = deferred();
    const nextEntered = deferred();
    const nextRelease = deferred();
    const closed: string[] = [];
    let oldCalls = 0;
    let dedupCalls = 0;
    let nextCalls = 0;
    const Handle = createServiceToken<object>("dedup owner witness");
    const app = createApplication({
      providers: [],
      services: [
        ...createCacheBindings(settings),
        resourceService(Handle, {
          lifetime: "execution",
          dependencies: [CORE_EXECUTION_CONTEXT_TOKEN],
          create: (context) => ({
            name: "dedup execution",
            open: () => ({ ok: true, value: {} }),
            close: () => {
              closed.push(context.externalId ?? "unknown");
            },
          }),
        }),
      ],
    });
    let original: Promise<unknown> | undefined;
    let waiter: Promise<unknown> | undefined;
    let successor: Promise<unknown> | undefined;
    let follower: Promise<unknown> | undefined;
    try {
      await app.start();
      original = app.run({ kind: "command", externalId: "elector" }, (s) => {
        s.resolve(Handle);
        const cache = s.resolve(CORE_CACHE_TOKEN);
        void cache.remember("key", async () => {
          oldCalls++;
          entered.resolve();
          await dedupRelease.promise;
          return "dedup-value";
        });
      });
      await entered.promise;
      waiter = app.run({ kind: "command", externalId: "dedup" }, (s) => {
        s.resolve(Handle);
        return s.resolve(CORE_CACHE_TOKEN).remember("key", async () => {
          dedupCalls++;
          return "wrong";
        });
      });
      await turn();
      assert.equal(
        closed.includes("elector"),
        false,
        "unawaited elected loader remains with original execution",
      );
      dedupRelease.resolve();
      await original;
      assert.equal(await waiter, "dedup-value");
      assert.equal(dedupCalls, 0, "dedup must never invoke the waiting execution loader");
      // Clear the published dedup value before electing the independent stale fill.
      await app.run((s) => s.resolve(CORE_CACHE_TOKEN).clear());
      original = app.run((s) => {
        void s.resolve(CORE_CACHE_TOKEN).remember("key", async () => {
          oldEntered.resolve();
          await oldRelease.promise;
          return "old";
        });
      });
      await oldEntered.promise;
      await app.run((s) => s.resolve(CORE_CACHE_TOKEN).clear());
      successor = app.run((s) =>
        s.resolve(CORE_CACHE_TOKEN).remember("key", async () => {
          nextCalls++;
          nextEntered.resolve();
          await nextRelease.promise;
          return "new";
        }),
      );
      await nextEntered.promise;
      oldRelease.resolve();
      await original;
      assert.equal(
        await app.run((s) => s.resolve(CORE_CACHE_TOKEN).get("key")),
        undefined,
        "old result fenced after clear",
      );
      follower = app.run((s) =>
        s.resolve(CORE_CACHE_TOKEN).remember("key", async () => {
          dedupCalls++;
          return "wrong-follower";
        }),
      );
      await turn();
      nextRelease.resolve();
      assert.equal(await successor, "new");
      assert.equal(await follower, "new", "old finally must not erase successor ownership");
      await waiter;
      assert.equal(oldCalls, 1);
      assert.equal(nextCalls, 1);
      assert.equal(dedupCalls, 0);
      assert.ok(closed.includes("elector"));
      assert.equal(await app.run((s) => s.resolve(CORE_CACHE_TOKEN).get("key")), "new");
    } finally {
      dedupRelease.resolve();
      oldRelease.resolve();
      nextRelease.resolve();
      await Promise.allSettled(
        [original, waiter, successor, follower].filter((p) => p !== undefined),
      );
      if (app.state.phase === "ready") await app.run((s) => s.resolve(CORE_CACHE_TOKEN).clear());
      await app.stop();
    }
  }, 10000);
});
