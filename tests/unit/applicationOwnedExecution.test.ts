import { test } from "bun:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import {
  CORE_EXECUTION_OWNERSHIP_TOKEN,
  type Joined,
  type OwnedBoundary,
  type OwnedExecution,
  type OwnedInvocation,
} from "@getstrata/core/contracts/executionOwnership";
import { aliasService, service, valueService } from "@getstrata/core/contracts/services";
import { createServiceToken, serviceTokenName } from "@getstrata/core/contracts/token";
import { createApplication } from "@getstrata/core/runtime/application";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";

const observe = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
function attempt(work: () => unknown) {
  try {
    return { ok: true as const, value: work() };
  } catch (error) {
    return { ok: false as const, error };
  }
}
function code(error: unknown, expected: string) {
  assert.ok(error instanceof Error);
  assert.equal(Reflect.get(error, "code"), expected);
}
function failures(error: unknown, expected: readonly unknown[]) {
  if (expected.length === 1) {
    assert.equal(error, expected[0], "one strict occurrence preserves its exact opaque payload");
    return;
  }
  assert.ok(error instanceof AggregateError);
  assert.equal(
    error.errors.length,
    expected.length,
    "private strict occurrences are not dropped or re-appended from inspected provenance",
  );
  expected.forEach((value, index) => {
    assert.equal(error.errors[index], value);
  });
}

test("owned execution token is reserved and aliases preserve exact implicit execution identity", async () => {
  const Alias = createServiceToken<OwnedExecution>("owned alias");
  const Captive = createServiceToken<OwnedExecution>("captive owned");
  const SameLabel = createServiceToken<OwnedExecution>(
    serviceTokenName(CORE_EXECUTION_OWNERSHIP_TOKEN),
  );
  const fake: OwnedExecution = {
    joined: async () => {
      throw new Error("fake");
    },
  };
  let effects = 0;
  for (const definition of [
    { providers: [], services: [valueService(CORE_EXECUTION_OWNERSHIP_TOKEN, fake)] },
    { providers: [], overrides: [valueService(CORE_EXECUTION_OWNERSHIP_TOKEN, fake)] },
    {
      providers: [
        {
          name: "never",
          setup() {
            effects++;
          },
        },
      ],
      services: [
        aliasService(Alias, CORE_EXECUTION_OWNERSHIP_TOKEN),
        service(Captive, {
          lifetime: "application",
          dependencies: [Alias],
          create(value) {
            effects++;
            return value;
          },
        }),
      ],
    },
  ]) {
    const result = attempt(() => createApplication(definition));
    assert.equal(
      result.ok,
      false,
      "reserved owned authority and captive aliases fail before effects",
    );
    if (!result.ok)
      code(
        result.error,
        definition.services?.some((item) => item.kind === "factory")
          ? "SERVICE_GRAPH_CAPTIVE_DEPENDENCY"
          : "SERVICE_GRAPH_RESERVED_TOKEN",
      );
  }
  assert.equal(effects, 0);
  const app = createApplication({
    providers: [],
    services: [aliasService(Alias, CORE_EXECUTION_OWNERSHIP_TOKEN), valueService(SameLabel, fake)],
  });
  await app.start();
  const resolved: OwnedExecution[] = [];
  const aliases: boolean[] = [];
  try {
    for (let index = 0; index < 2; index++)
      await app.run((scope) => {
        const value = scope.resolve(Alias);
        resolved.push(value);
        aliases.push(
          value === scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN) &&
            scope.resolve(SameLabel) === fake,
        );
      });
    assert.deepEqual(aliases, [true, true]);
    assert.notEqual(
      resolved[0],
      resolved[1],
      "owned dispatch authority is fresh for each exact run",
    );
    assert.equal(Object.isFrozen(resolved[0]), true);
  } finally {
    await app.stop();
  }
});

test("joined ownership waits actual descendants and own cleanup while public operations still observe only their body", async () => {
  const releaseChild = deferred();
  const releaseClose = deferred();
  const childEntered = deferred();
  const closeEntered = deferred();
  const operationObserved = deferred();
  const value = {};
  const events: string[] = [];
  let joined: Promise<Joined<object>> | undefined;
  let publicValue: unknown;
  let joinedPublished = false;
  let cleanupEffects = 0;
  let cleanupObservation: Awaited<ReturnType<typeof observe<unknown>>> | undefined;
  let handleClosed: unknown;
  const app = createApplication({ providers: [] });
  await app.start();
  const run = app.run(async (scope) => {
    const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    joined = ownership.joined(async (task) => {
      await task.acquire({
        name: "owned handle",
        open: () => ({ ok: true, value }),
        async close(handle) {
          cleanupObservation = await observe(
            ownership.joined(() => {
              cleanupEffects++;
              return 0;
            }),
          );
          events.push("close.enter");
          handleClosed = handle;
          closeEntered.resolve();
          await releaseClose.promise;
          events.push("close.end");
        },
      });
      publicValue = await operations.operation(() => {
        void operations.operation(async () => {
          childEntered.resolve();
          await releaseChild.promise;
          events.push("child.end");
        });
        return 17;
      });
      operationObserved.resolve();
      events.push("body.end");
      return value;
    });
    void joined.then(() => {
      joinedPublished = true;
    });
    return joined;
  });
  const outcome = observe(run);
  try {
    await bounded(Promise.all([childEntered.promise, operationObserved.promise]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      joinedPublished,
      false,
      "joined observation cannot publish before actual descendant and cleanup settlement",
    );
    assert.equal(
      publicValue,
      17,
      "public operation result remains a body result before actual descendants finish",
    );
    assert.ok(joined);
    await pending(joined);
    assert.deepEqual(
      events,
      ["body.end"],
      "joined own resource cannot close before an actual nested operation settles",
    );
    releaseChild.resolve();
    await bounded(closeEntered.promise);
    assert.equal(
      cleanupObservation?.ok,
      false,
      "owned resource cleanup cannot inherit its still-active parent body authority",
    );
    if (cleanupObservation && !cleanupObservation.ok)
      code(cleanupObservation.error, "APPLICATION_SCOPE_EXPIRED");
    assert.equal(cleanupEffects, 0);
    await pending(joined);
    assert.deepEqual(
      events,
      ["body.end", "child.end", "close.enter"],
      "joined observation waits actual own close acknowledgement",
    );
    releaseClose.resolve();
    const result = await bounded(outcome);
    assert.ok(result.ok, "clean joined ownership does not manufacture strict failure");
    assert.equal(result.value.invoked, true);
    assert.equal(result.value.body.ok, true);
    if (result.value.body.ok) assert.equal(result.value.body.value, value);
    assert.equal(handleClosed, value);
    assert.equal(result.value.strictFailed, false);
    assert.equal(result.value.retained, false);
    assert.deepEqual(result.value.strict, []);
    for (const record of [result.value, result.value.body, result.value.strict])
      assert.equal(Object.isFrozen(record), true);
    assert.equal(
      Object.isFrozen(value),
      false,
      "joined records never freeze caller-owned body payloads",
    );
  } finally {
    releaseChild.resolve();
    releaseClose.resolve();
    await Promise.allSettled([run]);
    await app.stop();
  }
});

test("joined ordinary body errors stay recoverable while same opaque strict occurrences propagate exactly once", async () => {
  const opaque = new AggregateError([undefined], "caller opaque");
  const flush = false;
  let ordinary!: Joined<never>;
  let joined!: Joined<never>;
  let nested!: Joined<number>;
  let closes = 0;
  const app = createApplication({ providers: [] });
  await app.start();
  try {
    const result = await observe(
      app.run(async (scope) => {
        const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
        ordinary = await ownership.joined(() => {
          throw opaque;
        });
        joined = await ownership.joined(async (task) => {
          await task
            .acquire({
              name: "discharged failure",
              open: () => ({ ok: false, error: opaque, disposition: "not-acquired" }),
              close() {},
            })
            .catch(() => {});
          await task.acquire({
            name: "flush failure",
            open: () => ({ ok: true, value: 1 }),
            flush() {
              throw flush;
            },
            close() {
              closes++;
            },
          });
          nested = await ownership.joined(async (child) => {
            await child
              .acquire({
                name: "child failure",
                open: () => ({ ok: false, error: opaque, disposition: "not-acquired" }),
                close() {},
              })
              .catch(() => {});
            return 3;
          });
          throw opaque;
        });
        return "recovered observations";
      }),
    );
    assert.equal(ordinary.invoked, true);
    assert.deepEqual(ordinary.body, { ok: false, error: opaque });
    assert.equal(
      ordinary.strictFailed,
      false,
      "invoked ordinary joined failure stays recoverable outside strict provenance",
    );
    assert.deepEqual(ordinary.strict, []);
    assert.equal(joined.strictFailed, true);
    assert.equal(joined.retained, false);
    assert.deepEqual(joined.body, { ok: false, error: opaque });
    assert.deepEqual(
      joined.strict.map((entry) => entry.error),
      [opaque, opaque, flush],
      "strict provenance preserves reservation then descendant then cleanup order without ordinary body duplication",
    );
    assert.deepEqual(
      nested.strict.map((entry) => entry.error),
      [opaque],
    );
    assert.equal(Object.isFrozen(joined.strict), true);
    for (const entry of joined.strict) assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(opaque), false);
    assert.equal(
      result.ok,
      false,
      "catching joined observations does not recover admitted strict failures",
    );
    if (!result.ok) failures(result.error, [opaque, opaque, flush]);
    assert.equal(closes, 1, "failed own flush still closes the original acquired resource once");
    const done = await app.stop();
    assert.equal(done.successful, false);
    assert.deepEqual(
      done.snapshot.errors.filter((error) => error.kind === "cleanup").map((error) => error.error),
      [flush],
    );
  } finally {
    await app.stop();
  }
});

test("joined reservation skips settle with strict provenance while failed admission adds no phantom occurrence", async () => {
  const cancellation = Symbol("reserved skip");
  const external = new AbortController();
  let invoked = 0;
  let invalid: unknown;
  let late: unknown;
  let joined!: Joined<number>;
  const app = createApplication({ providers: [] });
  await app.start();
  try {
    const result = await observe(
      app.run({ kind: "command", signal: external.signal }, async (scope) => {
        const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
        const bad = await observe(ownership.joined(1 as never));
        if (!bad.ok) invalid = bad.error;
        const reserved = ownership.joined(() => {
          invoked++;
          return 7;
        });
        external.abort(cancellation);
        joined = await reserved;
        const denied = await observe(
          ownership.joined(() => {
            invoked++;
            return 8;
          }),
        );
        if (!denied.ok) late = denied.error;
        return "caught skip";
      }),
    );
    assert.ok(invalid instanceof TypeError);
    assert.equal(late, cancellation);
    assert.equal(
      invoked,
      0,
      "reserved cancellation and failed admission never invoke callback effects",
    );
    assert.equal(
      joined.invoked,
      false,
      "reserved skipped owned observation is explicitly not invoked",
    );
    assert.deepEqual(joined.body, { ok: false, error: cancellation });
    assert.equal(joined.strictFailed, true);
    assert.equal(joined.retained, false);
    assert.deepEqual(
      joined.strict.map((entry) => entry.error),
      [cancellation],
      "reserved skipped body has one existing strict occurrence",
    );
    assert.equal(result.ok, false);
    if (!result.ok) failures(result.error, [cancellation]);
    assert.equal((await app.stop()).successful, true);
  } finally {
    await app.stop();
  }
});

test("ignored owned acquisition remains joined and retained descendant ownership remains truthful", async () => {
  const opened = deferred();
  const releaseOpen = deferred();
  const bodyEnded = deferred();
  const value = {};
  const unknown = Symbol("unknown open");
  let originalClosed: unknown;
  let outer!: Joined<number>;
  let inner!: Joined<number>;
  let pendingJoin: Promise<Joined<number>> | undefined;
  const app = createApplication({ providers: [] });
  await app.start();
  const run = app.run(async (scope) => {
    const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    pendingJoin = ownership.joined((task) => {
      void task.acquire({
        name: "ignored known open",
        async open() {
          opened.resolve();
          await releaseOpen.promise;
          return { ok: true, value };
        },
        close(handle) {
          originalClosed = handle;
        },
      });
      bodyEnded.resolve();
      return 1;
    });
    await pendingJoin;
    outer = await ownership.joined(async () => {
      inner = await ownership.joined(async (task) => {
        await task
          .acquire({
            name: "unknown descendant",
            open: () => ({ ok: false, error: unknown, disposition: "unknown" }),
            close() {},
          })
          .catch(() => {});
        return 2;
      });
      return 3;
    });
    return "observed retained failure";
  });
  const outcome = observe(run);
  try {
    await bounded(Promise.all([opened.promise, bodyEnded.promise]));
    assert.ok(pendingJoin);
    await pending(pendingJoin);
    assert.equal(
      originalClosed,
      undefined,
      "ignored owned open prevents joined publication and premature handle cleanup",
    );
    releaseOpen.resolve();
    const result = await bounded(outcome);
    assert.equal(
      originalClosed,
      value,
      "ignored owned acquisition closes its actual late successful handle before joining",
    );
    assert.equal(inner.retained, true);
    assert.equal(
      outer.retained,
      true,
      "joined retained ownership includes actual descendant obligations",
    );
    assert.equal(outer.strictFailed, true);
    assert.deepEqual(
      outer.strict.map((entry) => entry.error),
      [unknown],
    );
    assert.equal(result.ok, false);
    if (!result.ok) failures(result.error, [unknown]);
    const done = await app.stop();
    assert.equal(done.successful, false);
    assert.deepEqual(done.snapshot.retainedResources, ["unknown descendant"]);
    assert.equal(
      done.snapshot.errors.some((entry) => entry.error === unknown),
      true,
    );
  } finally {
    releaseOpen.resolve();
    await Promise.allSettled([run]);
    await app.stop();
  }
});

test("owned membership follows actual active descendants and rejects captured outer branches and other runs", async () => {
  const entered = deferred();
  const release = deferred();
  const descendantEntered = deferred();
  const releaseBoundary = deferred();
  const boundaryBodyEnded = deferred();
  let boundary!: OwnedBoundary;
  let ownership!: OwnedExecution;
  let direct: ReturnType<typeof attempt> | undefined;
  let descendant: ReturnType<typeof attempt> | undefined;
  let unrelated: ReturnType<typeof attempt> | undefined;
  let crossRun: ReturnType<typeof attempt> | undefined;
  let ownFromDescendant: Awaited<ReturnType<typeof observe<unknown>>> | undefined;
  let directBindFromDescendant: ReturnType<typeof attempt> | undefined;
  let unauthorizedOpens = 0;
  let crossRunEffects = 0;
  const app = createApplication({ providers: [] });
  await app.start();
  const run = app.run(async (root) => {
    ownership = root.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    const operations = root.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    const joined = ownership.joined(async (task) => {
      boundary = task;
      direct = attempt(task.assertWithin);
      void operations.operation(async () => {
        ownFromDescendant = await observe(
          task.acquire({
            name: "wrong direct body",
            open() {
              unauthorizedOpens++;
              return { ok: true, value: 1 };
            },
            close() {},
          }),
        );
        directBindFromDescendant = attempt(() => task.bindNative(async () => 1));
        descendantEntered.resolve();
        await release.promise;
        descendant = attempt(task.assertWithin);
      });
      void root.spawn(async () => {
        await release.promise;
        unrelated = attempt(task.assertWithin);
      });
      entered.resolve();
      await releaseBoundary.promise;
      boundaryBodyEnded.resolve();
      return 7;
    });
    return joined;
  });
  const outcome = observe(run);
  let otherRun: Promise<unknown> | undefined;
  try {
    await bounded(Promise.all([entered.promise, descendantEntered.promise]));
    assert.equal(
      ownFromDescendant?.ok,
      false,
      "boundary acquisition rejects a descendant while the direct owner body is still live",
    );
    assert.equal(
      unauthorizedOpens,
      0,
      "wrong direct body cannot reserve or open an owned resource",
    );
    assert.equal(directBindFromDescendant?.ok, false);
    const absent = attempt(boundary.assertWithin);
    assert.equal(absent.ok, false);
    if (!absent.ok) code(absent.error, "APPLICATION_SCOPE_EXPIRED");
    otherRun = app.run(async () => {
      crossRun = attempt(boundary.assertWithin);
      return observe(
        ownership.joined(() => {
          crossRunEffects++;
          return 8;
        }),
      );
    });
    const other = (await bounded(otherRun)) as Awaited<ReturnType<typeof observe<Joined<number>>>>;
    assert.equal(other.ok, false, "owned capability rejects admission from a different exact run");
    if (!other.ok) code(other.error, "APPLICATION_SCOPE_EXPIRED");
    releaseBoundary.resolve();
    await bounded(boundaryBodyEnded.promise);
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    const result = await bounded(outcome);
    assert.ok(result.ok, "pre-admission membership failures add no strict task occurrences");
    assert.equal(direct?.ok, true);
    assert.equal(
      descendant?.ok,
      true,
      "live descendant remains inside boundary after boundary callback body returns",
    );
    assert.equal(
      unrelated?.ok,
      false,
      "captured outer spawn is not adopted into the owned boundary",
    );
    assert.equal(crossRun?.ok, false);
    if (unrelated && !unrelated.ok) code(unrelated.error, "APPLICATION_SCOPE_EXPIRED");
    if (crossRun && !crossRun.ok) code(crossRun.error, "APPLICATION_SCOPE_EXPIRED");
    assert.equal(
      ownFromDescendant?.ok,
      false,
      "boundary acquisition belongs only to its exact live direct body",
    );
    assert.equal(directBindFromDescendant?.ok, false);
    assert.equal(unauthorizedOpens, 0);
    assert.equal(crossRunEffects, 0);
    const stale = attempt(boundary.assertWithin);
    assert.equal(stale.ok, false);
  } finally {
    releaseBoundary.resolve();
    release.resolve();
    await Promise.allSettled([run, ...(otherRun ? [otherRun] : [])]);
    await app.stop();
  }
});

test("bound native continuation restores only its captured live direct body and never revives a closed boundary", async () => {
  const external = new AsyncResource("owned-native-delivery");
  const ready = deferred();
  const release = deferred();
  const callbackEntered = deferred();
  const otherCallbackEntered = deferred();
  const callbackRelease = deferred();
  let native: ((value: number) => Promise<number>) | undefined;
  let delivered: Promise<number> | undefined;
  let otherRun: Promise<number> | undefined;
  let boundary!: OwnedBoundary;
  let sourceId: string | undefined;
  let deliveryId: string | undefined;
  let effects = 0;
  const inside: ReturnType<typeof attempt>[] = [];
  let beforeNative: ReturnType<typeof attempt> | undefined;
  let afterNative: ReturnType<typeof attempt> | undefined;
  let unrelatedMembership: ReturnType<typeof attempt> | undefined;
  const app = createApplication({ providers: [] });
  await app.start();
  const run = app.run(async (scope) => {
    sourceId = scope.context.executionId;
    const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    return ownership.joined(async (task) => {
      boundary = task;
      native = task.bindNative(async (value: number) => {
        effects++;
        inside.push(attempt(task.assertWithin));
        const nested = await ownership.joined(async () => {
          if (value === 7) callbackEntered.resolve();
          else otherCallbackEntered.resolve();
          await callbackRelease.promise;
          return value + 1;
        });
        return nested.body.ok ? nested.body.value : -1;
      });
      ready.resolve();
      await release.promise;
      return 3;
    });
  });
  const outcome = observe(run);
  try {
    await bounded(ready.promise);
    assert.ok(native);
    const capturedNative = native;
    delivered = external.runInAsyncScope(capturedNative, undefined, 7);
    await bounded(callbackEntered.promise);
    otherRun = app.run(async (delivery) => {
      deliveryId = delivery.context.executionId;
      const operations = delivery.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
      beforeNative = attempt(operations.assertActive);
      unrelatedMembership = attempt(boundary.assertWithin);
      const result = await capturedNative(9);
      afterNative = attempt(operations.assertActive);
      return result;
    });
    void observe(otherRun);
    await bounded(otherCallbackEntered.promise);
    release.resolve();
    await pending(run);
    assert.equal(effects, 2);
    assert.deepEqual(
      inside.map((item) => item.ok),
      [true, true],
      "native delivery from absent or unrelated run frame restores the exact active captured boundary",
    );
    assert.notEqual(deliveryId, sourceId);
    assert.equal(
      unrelatedMembership?.ok,
      false,
      "delivery run is unrelated until the explicit native continuation restores captured C",
    );
    callbackRelease.resolve();
    assert.equal(await bounded(delivered), 8);
    assert.equal(
      await bounded(otherRun),
      10,
      "native child dispatch stays with captured run rather than adopting the delivery run",
    );
    assert.equal(beforeNative?.ok, true);
    assert.equal(
      afterNative?.ok,
      true,
      "bound native delivery restores the unrelated calling run after actual continuation settlement",
    );
    assert.equal((await bounded(outcome)).ok, true);
    const stale = await observe(external.runInAsyncScope(capturedNative, undefined, 11));
    assert.equal(
      stale.ok,
      false,
      "native callback after boundary closes rejects before running controller effects",
    );
    if (!stale.ok) code(stale.error, "APPLICATION_SCOPE_EXPIRED");
    assert.equal(
      effects,
      2,
      "closed native continuation cannot mutate stage or reopen child admission",
    );
  } finally {
    release.resolve();
    callbackRelease.resolve();
    await Promise.allSettled([
      run,
      ...(delivered ? [delivered] : []),
      ...(otherRun ? [otherRun] : []),
    ]);
    external.emitDestroy();
    await app.stop();
  }
});

test("owned entry covers body then reflection and native assimilation and restores the surrounding context", async () => {
  const storage = new AsyncLocalStorage<string>();
  const seen: Array<string | undefined> = [];
  const membership: ReturnType<typeof attempt>[] = [];
  let after: string | undefined;
  const app = createApplication({ providers: [] });
  await app.start();
  try {
    const result = await storage.run("parent", () =>
      app.run(async (scope) => {
        const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
        const joined = await ownership.joined(
          (task) => {
            seen.push(storage.getStore());
            // biome-ignore lint/suspicious/noThenProperty: Deliberate hostile thenable proves the whole invocation context covers reflection and native assimilation.
            const thenable = Object.defineProperty({}, "then", {
              get() {
                seen.push(storage.getStore());
                membership.push(attempt(task.assertWithin));
                return (resolve: (value: number) => void) => {
                  seen.push(storage.getStore());
                  membership.push(attempt(task.assertWithin));
                  resolve(17);
                };
              },
            });
            return thenable as unknown as Promise<number>;
          },
          (invoke) => storage.run("business", invoke),
        );
        after = storage.getStore();
        return joined;
      }),
    );
    assert.deepEqual(
      seen,
      ["business", "business", "business"],
      "owned enter spans complete invoke including hostile then lookup and Promise assimilation",
    );
    assert.deepEqual(
      membership.map((item) => item.ok),
      [true, true],
    );
    assert.equal(after, "parent", "owned enter restores the actual surrounding native context");
    assert.equal(result.invoked, true);
    assert.deepEqual(result.body, { ok: true, value: 17 });
    assert.equal(result.strictFailed, false);
  } finally {
    await app.stop();
  }
});

test("pre-invoke entry throw omission and asynchronous invoke close the reserved lease without orphaning a body", async () => {
  for (const variant of ["throw", "omit", "late"] as const) {
    const marker = Symbol(variant);
    let effects = 0;
    let joined!: Joined<number>;
    let saved: (() => unknown) | undefined;
    let lateError: ReturnType<typeof attempt> | undefined;
    const enter: OwnedInvocation = <R>(invoke: () => R): R => {
      if (variant === "throw") throw marker;
      if (variant === "late") saved = invoke;
      return undefined as R;
    };
    const app = createApplication({ providers: [] });
    await app.start();
    try {
      const result = await observe(
        app.run(async (scope) => {
          joined = await scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN).joined(() => {
            effects++;
            return 7;
          }, enter);
          if (saved) {
            await new Promise<void>((resolve) => setImmediate(resolve));
            lateError = attempt(saved);
          }
          return "caught entry failure";
        }),
      );
      assert.equal(effects, 0, "invalid pre-invoke wrapper cannot run or revive the reserved body");
      assert.equal(joined.invoked, false);
      assert.equal(joined.body.ok, false);
      assert.equal(joined.strictFailed, true);
      assert.equal(
        joined.strict.length,
        1,
        "pre-invoke protocol failure has exactly one strict skipped occurrence",
      );
      assert.equal(joined.retained, false);
      const entryError = joined.strict[0]?.error;
      if (variant === "throw") assert.equal(entryError, marker);
      else assert.ok(entryError instanceof Error);
      if (!joined.body.ok) assert.equal(joined.body.error, entryError);
      if (variant === "late")
        assert.equal(
          lateError?.ok,
          false,
          "asynchronous invoke after entry wrapper return is rejected synchronously",
        );
      assert.equal(result.ok, false);
      if (!result.ok) failures(result.error, [entryError]);
      assert.equal((await app.stop()).successful, true);
    } finally {
      await app.stop();
    }
  }
});

test("double and post-invoke entry failures stay strict while the admitted body and cleanup settle actually", async () => {
  for (const variant of ["double", "post-throw"] as const) {
    const marker = Symbol(variant);
    const entered = deferred();
    const release = deferred();
    const closeEntered = deferred();
    const closeRelease = deferred();
    let effects = 0;
    let closes = 0;
    let joined: Promise<Joined<number>> | undefined;
    let observation!: Joined<number>;
    const enter: OwnedInvocation = <R>(invoke: () => R): R => {
      const value = invoke();
      if (variant === "post-throw") throw marker;
      invoke();
      return value;
    };
    const app = createApplication({ providers: [] });
    await app.start();
    const run = app.run(async (scope) => {
      joined = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN).joined(async (task) => {
        effects++;
        await task.acquire({
          name: "entry body handle",
          open: () => ({ ok: true, value: 1 }),
          async close() {
            closeEntered.resolve();
            await closeRelease.promise;
            closes++;
          },
        });
        entered.resolve();
        await release.promise;
        return 11;
      }, enter);
      observation = await joined;
      return "caught entry failure";
    });
    const outcome = observe(run);
    try {
      await bounded(entered.promise);
      assert.ok(joined);
      await pending(joined);
      assert.equal(effects, 1, "invalid entry wrapper invokes actual work at most once");
      assert.equal(
        closes,
        0,
        "post-invoke wrapper failure cannot settle or dispose an admitted pending body",
      );
      release.resolve();
      await bounded(closeEntered.promise);
      await pending(joined);
      assert.equal(
        closes,
        0,
        "post-invoke strict protocol waits actual resource close acknowledgement",
      );
      closeRelease.resolve();
      const result = await bounded(outcome);
      assert.equal(observation.invoked, true);
      assert.deepEqual(
        observation.body,
        { ok: true, value: 11 },
        "entry protocol failure does not replace actual admitted body outcome",
      );
      assert.equal(observation.strictFailed, true);
      assert.equal(observation.strict.length, 1);
      assert.equal(observation.retained, false);
      assert.equal(closes, 1);
      const entryError = observation.strict[0]?.error;
      if (variant === "post-throw") assert.equal(entryError, marker);
      else assert.ok(entryError instanceof Error);
      assert.equal(result.ok, false);
      if (!result.ok) failures(result.error, [entryError]);
      assert.equal((await app.stop()).successful, true);
    } finally {
      release.resolve();
      closeRelease.resolve();
      await Promise.allSettled([run]);
      await app.stop();
    }
  }
});

test("invalid owned entry and native callback inputs fail before effects without poisoning later joined work", async () => {
  const value = {};
  let invalidEffects = 0;
  let validEffects = 0;
  let invalidEntry: Awaited<ReturnType<typeof observe<Joined<number>>>> | undefined;
  let invalidNative: ReturnType<typeof attempt> | undefined;
  let first!: Joined<object>;
  let later!: Joined<number>;
  const app = createApplication({ providers: [] });
  await app.start();
  const run = app.run(async (scope) => {
    const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    invalidEntry = await observe(
      ownership.joined(() => {
        invalidEffects++;
        return 1;
      }, null as never),
    );
    first = await ownership.joined((boundary) => {
      invalidNative = attempt(() => boundary.bindNative(null as never));
      validEffects++;
      return value;
    });
    later = await ownership.joined(() => 17);
    return "clean after invalid inputs";
  });
  try {
    const result = await bounded(observe(run));
    assert.equal(
      invalidEntry?.ok,
      false,
      "invalid entry wrapper rejects before callback reservation or effects",
    );
    if (invalidEntry && !invalidEntry.ok) assert.ok(invalidEntry.error instanceof TypeError);
    assert.equal(invalidEffects, 0);
    assert.equal(
      invalidNative?.ok,
      false,
      "invalid native callback throws before binding a continuation",
    );
    if (invalidNative && !invalidNative.ok) assert.ok(invalidNative.error instanceof TypeError);
    assert.deepEqual(
      result,
      { ok: true, value: "clean after invalid inputs" },
      "caught invalid ownership inputs do not create phantom strict failures",
    );
    assert.equal(validEffects, 1);
    assert.equal(first.body.ok, true);
    if (first.body.ok) assert.equal(first.body.value, value);
    assert.deepEqual(later.body, { ok: true, value: 17 });
    for (const observation of [first, later]) {
      assert.equal(observation.invoked, true);
      assert.equal(observation.strictFailed, false);
      assert.equal(observation.retained, false);
      assert.deepEqual(observation.strict, []);
    }
    assert.equal((await app.stop()).successful, true);
  } finally {
    await Promise.allSettled([run]);
    await app.stop();
  }
});
