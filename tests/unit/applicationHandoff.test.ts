import { test } from "bun:test";
import assert from "node:assert/strict";
import { createCacheBindings } from "@getstrata/bootstrap/providers/cache";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import {
  type CacheLike,
  CORE_CACHE_BACKEND_TOKEN,
  CORE_CACHE_TOKEN,
} from "@getstrata/core/cache/tokens";
import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
import {
  CORE_EXECUTION_OPERATIONS_TOKEN,
  type ExecutionOperations,
} from "@getstrata/core/contracts/executionOperations";
import { resourceService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import {
  type CommandScope,
  createApplication,
  type ExecutionContext,
} from "@getstrata/core/runtime/application";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";

const cacheBindings = () =>
  createCacheBindings({
    driver: "array",
    ttlMs: 60000,
    maxEntries: 8,
    namespace: "handoff:cache:v3:",
  });
const observe = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
function errorCode(error: unknown, expected: string) {
  assert.ok(error instanceof Error);
  assert.equal(Reflect.get(error, "code"), expected);
}

test("explicit job handoff owns fresh capabilities and outlives its originating request", async () => {
  const Resource = createServiceToken<{ context: ExecutionContext; live: boolean }>(
    "handoff resource",
  );
  const closes: string[] = [];
  const sourceRelease = deferred();
  const targetRelease = deferred();
  const targetEntered = deferred();
  const chosenActor = { kind: "system" as const, policy: "explicit-job-policy" };
  const chosenTenant = { id: "target-tenant" };
  let sourceScope!: CommandScope;
  let sourceHandle!: { context: ExecutionContext; live: boolean };
  let targetHandle!: typeof sourceHandle;
  let sourceOperations!: ExecutionOperations;
  let targetOperations!: ExecutionOperations;
  let sourceCache!: CacheLike;
  let targetCache!: CacheLike;
  let wrongOperation: unknown;
  let wrongCache: unknown;
  let targetValue: unknown;
  let targetLiveAfterRelease = false;
  let job: Promise<number> | undefined;
  let jobOutcome: ReturnType<typeof observe<number>> | undefined;
  const app = createApplication({
    providers: [],
    services: [
      ...cacheBindings(),
      resourceService(Resource, {
        lifetime: "execution",
        dependencies: [CORE_EXECUTION_CONTEXT_TOKEN, CORE_CACHE_BACKEND_TOKEN],
        create(context) {
          const value = { context, live: true };
          return {
            name: "handoff resource",
            open: () => ({ ok: true, value }),
            close(handle) {
              handle.live = false;
              closes.push(`${context.kind}.close`);
            },
          };
        },
      }),
    ],
  });
  await app.start();
  const request = app.run(
    {
      kind: "request",
      actor: { kind: "principal", claims: { sub: "request-user" } },
      tenant: { id: "source-tenant" },
    },
    async (scope) => {
      sourceScope = scope;
      sourceHandle = scope.resolve(Resource);
      sourceOperations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
      sourceCache = scope.resolve(CORE_CACHE_TOKEN);
      job = app.run({ kind: "job", actor: chosenActor, tenant: chosenTenant }, async (target) => {
        targetHandle = target.resolve(Resource);
        targetOperations = target.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
        targetCache = target.resolve(CORE_CACHE_TOKEN);
        try {
          sourceOperations.assertActive();
        } catch (error) {
          wrongOperation = error;
        }
        const wrong = await observe(sourceCache.get("source-key"));
        wrongCache = wrong.ok ? undefined : wrong.error;
        targetValue = await targetCache.remember("target-key", async () => 41);
        targetEntered.resolve();
        await targetRelease.promise;
        targetLiveAfterRelease = targetHandle.live;
        return 42;
      });
      jobOutcome = observe(job);
      await sourceRelease.promise;
      return "request-result";
    },
  );
  const requestOutcome = observe(request);
  try {
    await bounded(targetEntered.promise);
    assert.equal(
      sourceHandle.live,
      true,
      "wrong-run handoff probes execute while source body and handle remain active",
    );
    assert.ok(
      wrongOperation instanceof Error,
      "source operations reject use from the fresh job while source body remains active",
    );
    errorCode(wrongOperation, "APPLICATION_SCOPE_EXPIRED");
    assert.ok(
      wrongCache instanceof Error,
      "source cache rejects use from the fresh job while source body remains active",
    );
    errorCode(wrongCache, "APPLICATION_SCOPE_EXPIRED");
    assert.equal(
      targetValue,
      41,
      "fresh target cache works while captured source cache is rejected",
    );
    assert.notEqual(targetOperations, sourceOperations);
    assert.notEqual(targetCache, sourceCache);
    assert.notEqual(targetHandle, sourceHandle, "explicit job obtains a fresh execution resource");
    assert.notEqual(targetHandle.context, sourceHandle.context);
    assert.notEqual(targetHandle.context.executionId, sourceHandle.context.executionId);
    assert.equal(targetHandle.context.applicationId, app.id);
    assert.equal(sourceHandle.context.applicationId, app.id);
    assert.deepEqual(
      targetHandle.context.actor,
      chosenActor,
      "job authority is the explicitly chosen actor",
    );
    assert.deepEqual(
      targetHandle.context.tenant,
      chosenTenant,
      "job tenant is explicitly chosen rather than inherited",
    );
    sourceRelease.resolve();
    assert.deepEqual(
      await bounded(requestOutcome),
      { ok: true, value: "request-result" },
      "source result does not join the independent handed-off job",
    );
    assert.deepEqual(
      closes,
      ["request.close"],
      "source resource closes while admitted target remains alive",
    );
    assert.equal(targetHandle.live, true);
    assert.ok(job);
    await pending(job);
    let expired: unknown;
    try {
      sourceScope.resolve(Resource);
    } catch (error) {
      expired = error;
    }
    errorCode(expired, "APPLICATION_SCOPE_EXPIRED");
    targetRelease.resolve();
    assert.ok(jobOutcome);
    assert.deepEqual(await bounded(jobOutcome), { ok: true, value: 42 });
    assert.equal(
      targetLiveAfterRelease,
      true,
      "job handle remains usable through its actual callback body",
    );
    assert.deepEqual(closes, ["request.close", "job.close"]);
  } finally {
    sourceRelease.resolve();
    targetRelease.resolve();
    await Promise.allSettled([request, ...(job ? [job] : [])]);
    await app.stop();
    await bounded(app.completion);
  }
});

test("fresh jobs ignore source cancellation unless the source signal is explicitly supplied", async () => {
  for (const variant of ["abort", "deadline"] as const) {
    const controller = new AbortController();
    const reason = { variant };
    const release = deferred();
    const sourceEntered = deferred();
    const unlinkedEntered = deferred();
    const linkedEntered = deferred();
    const sourceAborted = deferred();
    let source!: CommandScope;
    let unlinked!: ExecutionContext;
    let linked!: ExecutionContext;
    let job: Promise<string> | undefined;
    let linkedJob: Promise<string> | undefined;
    const chosenActor = { kind: "system" as const, policy: "independent-cancellation" };
    const app = createApplication({ providers: [], services: cacheBindings() });
    await app.start();
    const request = app.run(
      {
        kind: "request",
        tenant: { id: "source-only" },
        signal: controller.signal,
        ...(variant === "deadline" ? { deadlineAtMs: Date.now() + 1500 } : {}),
      },
      async (scope) => {
        source = scope;
        scope.signal.addEventListener("abort", () => sourceAborted.resolve(), { once: true });
        job = app.run({ kind: "job", actor: chosenActor }, async (target) => {
          unlinked = target.context;
          unlinkedEntered.resolve();
          await release.promise;
          return "independent actual success";
        });
        linkedJob = app.run(
          { kind: "job", actor: chosenActor, signal: scope.signal },
          async (target) => {
            linked = target.context;
            linkedEntered.resolve();
            await release.promise;
            return "linked actual success";
          },
        );
        void observe(job);
        void observe(linkedJob);
        sourceEntered.resolve();
        await release.promise;
        return "source actual success";
      },
    );
    void observe(request);
    try {
      await bounded(
        Promise.all([sourceEntered.promise, unlinkedEntered.promise, linkedEntered.promise]),
      );
      if (variant === "abort") controller.abort(reason);
      await bounded(sourceAborted.promise, "explicit source cancellation", 4000);
      assert.equal(source.signal.aborted, true);
      if (variant === "abort") assert.equal(source.signal.reason, reason);
      else errorCode(source.signal.reason, "EXECUTION_DEADLINE");
      assert.equal(
        unlinked.signal.aborted,
        false,
        "uncoupled handed-off job does not inherit source cancellation",
      );
      assert.equal(
        Object.hasOwn(unlinked, "deadlineAtMs"),
        false,
        "uncoupled job has no inherited deadline",
      );
      assert.equal(
        Object.hasOwn(unlinked, "tenant"),
        false,
        "uncoupled job has no inherited tenant",
      );
      assert.deepEqual(unlinked.actor, chosenActor);
      assert.equal(linked.signal.aborted, true);
      assert.equal(
        linked.signal.reason,
        source.signal.reason,
        "explicit source signal linkage preserves exact cancellation reason",
      );
      assert.ok(job);
      assert.ok(linkedJob);
      await pending(job);
      await pending(linkedJob);
      release.resolve();
      assert.equal(await bounded(job), "independent actual success");
      assert.equal(
        await bounded(linkedJob),
        "linked actual success",
        "invoked linked callback reports actual result after cooperative cancellation",
      );
      assert.equal(await bounded(request), "source actual success");
    } finally {
      release.resolve();
      await Promise.allSettled([request, ...(job ? [job] : []), ...(linkedJob ? [linkedJob] : [])]);
      await app.stop();
      await bounded(app.completion);
    }
  }
});

test("application stop joins handed-off jobs and strict descendants before closing backing resources", async () => {
  const Resource = createServiceToken<{ live: boolean }>("target resource");
  const targetEntered = deferred();
  const childEntered = deferred();
  const bodyEnded = deferred();
  const bodyRelease = deferred();
  const childRelease = deferred();
  const events: string[] = [];
  let creates = 0;
  let lateBodies = 0;
  let targetHandle!: { live: boolean };
  let childHandleLive = false;
  let job: Promise<number> | undefined;
  const backend = new CacheRepository(new SimpleCacheStore(new SimpleCache()));
  const app = createApplication({
    shutdownTimeoutMs: 10,
    providers: [],
    services: [
      ...cacheBindings(),
      resourceService(Resource, {
        lifetime: "execution",
        dependencies: [CORE_EXECUTION_CONTEXT_TOKEN, CORE_CACHE_BACKEND_TOKEN],
        create(context) {
          creates++;
          const value = { live: true };
          return {
            name: "target resource",
            open: () => ({ ok: true, value }),
            close(handle) {
              handle.live = false;
              if (context.kind === "job") events.push("target.resource.close");
            },
          };
        },
      }),
    ],
    overrides: [
      resourceService(CORE_CACHE_BACKEND_TOKEN, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          name: "backend",
          open: () => ({ ok: true, value: backend }),
          async close(value) {
            events.push("backend.close");
            await value.close();
          },
        }),
      }),
    ],
  });
  await app.start();
  const completion = app.completion.then((result) => {
    events.push("completion");
    return result;
  });
  const request = app.run({ kind: "request" }, () => {
    job = app.run(
      { kind: "job", actor: { kind: "system", policy: "drain-job" } },
      async (target) => {
        targetHandle = target.resolve(Resource);
        void target.spawn(async (child) => {
          const handle = child.resolve(Resource);
          childEntered.resolve();
          await childRelease.promise;
          childHandleLive = handle.live;
          events.push("child.body.end");
          return 8;
        });
        targetEntered.resolve();
        await bodyRelease.promise;
        events.push("target.body.end");
        bodyEnded.resolve();
        return 7;
      },
    );
    void observe(job);
    return "source returned";
  });
  void observe(request);
  let late: Promise<unknown> | undefined;
  try {
    assert.equal(await bounded(request), "source returned");
    await bounded(Promise.all([targetEntered.promise, childEntered.promise]));
    const stopped = await bounded(app.stop());
    assert.equal(stopped.timedOut, true, "bounded stop observes still-owned handed-off callbacks");
    assert.ok(job);
    await pending(job);
    await pending(completion);
    assert.deepEqual(
      events,
      [],
      "handoff stop cannot close target resource or backend before actual work settles",
    );
    const beforeLate = creates;
    late = app.run({ kind: "job", actor: { kind: "system", policy: "too-late" } }, () => {
      lateBodies++;
    });
    const denied = await observe(late);
    assert.equal(denied.ok, false, "shared application shutdown rejects a late explicit job");
    if (!denied.ok) errorCode(denied.error, "APPLICATION_NOT_READY");
    assert.equal(creates, beforeLate, "late job performs no execution resource factory effects");
    assert.equal(lateBodies, 0);
    bodyRelease.resolve();
    await bounded(bodyEnded.promise);
    await pending(job);
    await pending(completion);
    assert.equal(
      targetHandle.live,
      true,
      "strict descendant retains target execution resource after target body returns",
    );
    assert.deepEqual(
      events,
      ["target.body.end"],
      "strict child blocks resource and backend close after target body settlement",
    );
    childRelease.resolve();
    assert.deepEqual(await bounded(observe(job)), { ok: true, value: 7 });
    assert.equal(childHandleLive, true);
    assert.equal((await bounded(completion)).successful, true);
    assert.deepEqual(
      events,
      ["target.body.end", "child.body.end", "target.resource.close", "backend.close", "completion"],
      "actual handoff descendants and resource cleanup precede app completion in order",
    );
  } finally {
    bodyRelease.resolve();
    childRelease.resolve();
    await Promise.allSettled([request, ...(job ? [job] : []), ...(late ? [late] : [])]);
    await app.stop();
    await bounded(completion);
  }
});

test("request success stays independent of observed target body and cleanup failures", async () => {
  for (const cleanupFails of [false, true]) {
    const bodyError = Symbol("job body");
    const flushError = Symbol("job flush");
    const closed: string[] = [];
    const Resource = createServiceToken<object>("observed job resource");
    let job: Promise<never> | undefined;
    let jobOutcome: ReturnType<typeof observe<never>> | undefined;
    const app = createApplication({
      providers: [],
      services: [
        ...cacheBindings(),
        resourceService(Resource, {
          lifetime: "execution",
          dependencies: [CORE_EXECUTION_CONTEXT_TOKEN, CORE_CACHE_BACKEND_TOKEN],
          create(context) {
            return {
              name: "observed job resource",
              open: () => ({ ok: true, value: {} }),
              flush() {
                if (context.kind === "job" && cleanupFails) throw flushError;
              },
              close() {
                closed.push(context.kind);
              },
            };
          },
        }),
      ],
    });
    await app.start();
    const request = app.run({ kind: "request" }, () => {
      job = app.run(
        { kind: "job", actor: { kind: "system", policy: "observable-failure" } },
        () => {
          throw bodyError;
        },
      );
      jobOutcome = observe(job);
      return "request success";
    });
    void observe(request);
    try {
      assert.deepEqual(
        await bounded(observe(request)),
        { ok: true, value: "request success" },
        "target failure does not poison the originating request result",
      );
      assert.ok(jobOutcome);
      const target = await bounded(jobOutcome);
      assert.equal(target.ok, false, "original handed-off job outcome reports its actual failure");
      if (!target.ok) {
        if (!cleanupFails)
          assert.equal(
            target.error,
            bodyError,
            "body-only handoff rejection preserves exact opaque payload",
          );
        else {
          assert.ok(target.error instanceof AggregateError);
          assert.deepEqual(
            target.error.errors,
            [bodyError, flushError],
            "handoff outcome preserves ordered body and cleanup occurrences",
          );
          assert.equal(target.error.errors[0], bodyError);
          assert.equal(target.error.errors[1], flushError);
        }
      }
      assert.equal(
        closed.filter((kind) => kind === "job").length,
        1,
        "job resource closes exactly once even after failed flush",
      );
      const stopped = await app.stop();
      assert.equal(
        stopped.successful,
        !cleanupFails,
        "observing target rejection cannot erase failed cleanup disposition",
      );
      assert.equal(stopped.snapshot.cleanup, cleanupFails ? "failed" : "clean");
      assert.deepEqual(stopped.snapshot.retainedResources, []);
      assert.deepEqual(
        stopped.snapshot.errors
          .filter((entry) => entry.kind === "cleanup")
          .map((entry) => entry.error),
        cleanupFails ? [flushError] : [],
        "application diagnostics preserve cleanup failure rather than ordinary job body failure",
      );
    } finally {
      await Promise.allSettled([request, ...(job ? [job] : [])]);
      await app.stop();
      await bounded(app.completion);
    }
  }
});
