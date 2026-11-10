import { test } from "bun:test";
import assert from "node:assert/strict";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import {
  CORE_EXECUTION_OWNERSHIP_TOKEN,
  type Joined,
  type OwnedBoundary,
} from "@getstrata/core/contracts/executionOwnership";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
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
function expired(result: Awaited<ReturnType<typeof observe>>) {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof Error);
    assert.equal(Reflect.get(result.error, "code"), "APPLICATION_SCOPE_EXPIRED");
  }
}

test("B1 bookkeeping runs after cancellation and when cancellation follows reservation", async () => {
  for (const timing of ["before-reservation", "after-reservation"] as const) {
    const app = createApplication({ providers: [] });
    const external = new AbortController();
    const cancellation = Object.freeze({ bookkeepingCancellation: timing });
    const denied: Awaited<ReturnType<typeof observe>>[] = [];
    let businessEffects = 0;
    let finalizerEffects = 0;
    let finalizer: Joined<void> | undefined;
    await app.start();
    try {
      const run = await observe(
        app.run({ kind: "command", signal: external.signal }, async (scope) => {
          const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
          const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
          await ownership.joined(async (boundary) => {
            if (timing === "before-reservation") external.abort(cancellation);
            const reserved = boundary.finalize(() => {
              finalizerEffects++;
              return undefined;
            });
            if (timing === "after-reservation") external.abort(cancellation);
            finalizer = await reserved;
            denied.push(
              await observe(
                operations.operation(() => {
                  businessEffects++;
                }),
              ),
            );
            denied.push(
              await observe(
                ownership.joined(() => {
                  businessEffects++;
                }),
              ),
            );
            denied.push(
              await observe(
                scope.spawn(() => {
                  businessEffects++;
                }),
              ),
            );
          });
        }),
      );
      assert.equal(
        finalizer?.invoked,
        true,
        "B1 admitted bookkeeping must invoke despite cancellation at either gate",
      );
      assert.deepEqual(finalizer?.body, { ok: true, value: undefined });
      assert.equal(finalizer?.strictFailed, false);
      assert.equal(finalizerEffects, 1);
      assert.equal(businessEffects, 0);
      assert.equal(denied.length, 3);
      for (const result of denied) {
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.error, cancellation);
      }
      assert.equal(
        run.ok,
        true,
        "rejected new business admission must not fabricate strict bookkeeping failure",
      );
    } finally {
      await app.stop();
    }
  }
});

test("B2 bookkeeping rejects descendant, ancestor, sibling, foreign, wrong-run, blank and stale admission", async () => {
  const ready = deferred();
  const release = deferred();
  const app = createApplication({ providers: [] });
  const foreign = createApplication({ providers: [] });
  let saved!: OwnedBoundary;
  let forbiddenEffects = 0;
  let allowedEffects = 0;
  const denied: Awaited<ReturnType<typeof observe>>[] = [];
  let invalidCallback: Awaited<ReturnType<typeof observe>> | undefined;
  await app.start();
  await foreign.start();
  const run = app.run(async (scope) => {
    const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    const controller = ownership.joined(async (boundary) => {
      saved = boundary;
      invalidCallback = await observe(boundary.finalize(1 as never));
      await boundary.finalize(() => {
        allowedEffects++;
        return undefined;
      });
      denied.push(
        await operations.operation(() =>
          observe(
            boundary.finalize(() => {
              forbiddenEffects++;
              return undefined;
            }),
          ),
        ),
      );
      // Invalid descendant admission must leave the live direct owner usable.
      await boundary.finalize(() => {
        allowedEffects++;
        return undefined;
      });
      ready.resolve();
      await release.promise;
      return "controller";
    });
    await ready.promise;
    denied.push(
      await observe(
        saved.finalize(() => {
          forbiddenEffects++;
          return undefined;
        }),
      ),
    );
    await ownership.joined(async () => {
      denied.push(
        await observe(
          saved.finalize(() => {
            forbiddenEffects++;
            return undefined;
          }),
        ),
      );
    });
    return controller;
  });
  const actual = observe(run);
  void actual.then(() => ready.resolve());
  let otherRun: Promise<unknown> | undefined;
  let foreignRun: Promise<unknown> | undefined;
  try {
    await bounded(ready.promise);
    denied.push(
      await observe(
        saved.finalize(() => {
          forbiddenEffects++;
          return undefined;
        }),
      ),
    );
    otherRun = app.run(async () => {
      denied.push(
        await observe(
          saved.finalize(() => {
            forbiddenEffects++;
            return undefined;
          }),
        ),
      );
    });
    foreignRun = foreign.run(async () => {
      denied.push(
        await observe(
          saved.finalize(() => {
            forbiddenEffects++;
            return undefined;
          }),
        ),
      );
    });
    await Promise.all([otherRun, foreignRun]);
    release.resolve();
    const result = await bounded(actual);
    denied.push(
      await observe(
        saved.finalize(() => {
          forbiddenEffects++;
          return undefined;
        }),
      ),
    );
    assert.equal(
      forbiddenEffects,
      0,
      "B2 exact-direct admission must reject every unrelated or expired caller before effects",
    );
    assert.equal(allowedEffects, 2);
    assert.equal(denied.length, 7);
    denied.forEach(expired);
    assert.equal(invalidCallback?.ok, false);
    if (invalidCallback && !invalidCallback.ok)
      assert.ok(invalidCallback.error instanceof TypeError);
    assert.equal(result.ok, true, "failed admission adds no private strict occurrence");
  } finally {
    release.resolve();
    await Promise.allSettled([run, actual, otherRun, foreignRun]);
    await app.stop();
    await foreign.stop();
  }
});

test("B3 strict bookkeeping keeps repeated falsy occurrences once while a LIFO loop continues", async () => {
  const app = createApplication({ providers: [] });
  const observations: Joined<void>[] = [];
  const calls: number[] = [];
  let controller: Joined<void> | undefined;
  await app.start();
  try {
    const result = await observe(
      app.run(async (scope) => {
        const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
        controller = await ownership.joined(async (boundary) => {
          for (const index of [2, 1, 0]) {
            observations.push(
              await boundary.finalize(() => {
                calls.push(index);
                if (index > 0) throw false;
                return undefined;
              }),
            );
          }
        });
      }),
    );
    assert.equal(
      result.ok,
      false,
      "B3 bookkeeping body failures must remain strict even when every Joined is inspected",
    );
    assert.deepEqual(calls, [2, 1, 0]);
    assert.ok(!result.ok && result.error instanceof AggregateError);
    assert.deepEqual(
      result.error.errors,
      [false, false],
      "B3 identical opaque payloads are separate occurrences without summary reinsertion",
    );
    assert.deepEqual(
      controller?.strict.map((failure) => failure.error),
      [false, false],
    );
    assert.equal(controller?.strictFailed, true);
    assert.deepEqual(
      observations.map((item) => item.strict.map((failure) => failure.error)),
      [[false], [false], []],
    );
    assert.deepEqual(
      observations.map((item) => item.invoked),
      [true, true, true],
    );
    for (const item of observations) {
      for (const value of [item, item.body, item.strict, ...item.strict])
        assert.equal(Object.isFrozen(value), true);
      assert.equal(item.retained, false);
    }
  } finally {
    await app.stop();
  }
});

test("B4 bookkeeping blanks whole invocation and joins actual unsafe thenable rejection through stop", async () => {
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  const entered = deferred();
  const release = deferred();
  const failure = Object.freeze({ bookkeeping: "late thenable rejection" });
  const records: Array<{ phase: string; method: string; ok: boolean }> = [];
  const attempted: Array<
    Promise<{ phase: string; method: string; result: Awaited<ReturnType<typeof observe>> }>
  > = [];
  let suppliedArguments = -1;
  let effects = 0;
  let closes = 0;
  let bookkeeping: Joined<void> | undefined;
  let waiter: Promise<Joined<void>> | undefined;
  await app.start();
  const run = app.run(async (scope) => {
    const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    const session = scope.resolve(DATABASE_SESSION_TOKEN);
    await ownership.joined(async (boundary) => {
      await boundary.acquire({
        name: "held bookkeeping owner",
        open: () => ({ ok: true, value: {} }),
        close() {
          closes++;
        },
      });
      const probe = (phase: string) => {
        for (const [method, work] of [
          ["operations.assertActive", () => operations.assertActive()],
          ["boundary.assertWithin", () => boundary.assertWithin()],
          ["boundary.bindNative", () => boundary.bindNative(async () => 1)],
        ] as const)
          records.push({ phase, method, ok: attempt(work).ok });
        for (const [method, promise] of [
          [
            "operations.operation",
            operations.operation(() => {
              effects++;
            }),
          ],
          [
            "ownership.joined",
            ownership.joined(() => {
              effects++;
            }),
          ],
          [
            "boundary.acquire",
            boundary.acquire({
              name: "forbidden",
              open: () => {
                effects++;
                return { ok: true, value: {} };
              },
              close() {},
            }),
          ],
          [
            "boundary.finalize",
            boundary.finalize(() => {
              effects++;
              return undefined;
            }),
          ],
          ["session.execute", session.execute({ text: "SELECT 1", params: [] })],
        ] as const)
          attempted.push(observe<unknown>(promise).then((result) => ({ phase, method, result })));
      };
      // biome-ignore lint/suspicious/noThenProperty: Unsafe runtime thenable intentionally tests native assimilation and actual joining.
      const target = Object.defineProperty({}, "then", {
        get() {
          probe("getter");
          return (_resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
            probe("native-then");
            entered.resolve();
            void release.promise.then(() => {
              probe("late");
              reject(failure);
            });
          };
        },
      });
      const thenable = new Proxy(target, {
        getOwnPropertyDescriptor(object, key) {
          if (key === "then") probe("descriptor");
          return Reflect.getOwnPropertyDescriptor(object, key);
        },
      });
      waiter = boundary.finalize(((...args: unknown[]) => {
        suppliedArguments = args.length;
        probe("body");
        return thenable;
      }) as unknown as () => undefined);
      bookkeeping = await waiter;
    });
  });
  const actual = observe(run);
  void actual.then(() => entered.resolve());
  let stop: ReturnType<typeof app.stop> | undefined;
  try {
    await bounded(entered.promise);
    assert.ok(waiter);
    await pending(waiter);
    await pending(run);
    assert.equal(closes, 0);
    stop = app.stop();
    await pending(stop);
    release.resolve();
    const outcome = await bounded(actual);
    const denied = await Promise.all(attempted);
    assert.equal(
      records.find((item) => item.phase === "getter" && item.method === "operations.assertActive")
        ?.ok,
      false,
      "B4 descriptor/getter/native assimilation must execute under whole-invoke blank authority",
    );
    assert.deepEqual([...new Set(records.map((item) => item.phase))].sort(), [
      "body",
      "descriptor",
      "getter",
      "late",
      "native-then",
    ]);
    assert.equal(
      records.every((item) => item.ok === false),
      true,
    );
    for (const item of denied) expired(item.result);
    assert.equal(suppliedArguments, 0);
    assert.equal(effects, 0);
    assert.equal(bookkeeping?.invoked, true);
    assert.deepEqual(bookkeeping?.body, { ok: false, error: failure });
    assert.deepEqual(
      bookkeeping?.strict.map((item) => item.error),
      [failure],
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.error, failure);
    assert.equal(closes, 1);
    assert.equal((await stop).successful, true);
  } finally {
    release.resolve();
    await Promise.allSettled([run, actual, waiter, stop, ...attempted]);
    await app.stop();
  }
});

test("B5 ignored reserved bookkeeping still invokes after parent body closes and joins its real completion", async () => {
  const app = createApplication({ providers: [] });
  const entered = deferred();
  const release = deferred();
  const events: string[] = [];
  await app.start();
  const run = app.run(async (scope) => {
    const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    await scope.acquire({
      name: "ignored bookkeeping resource",
      open: () => {
        events.push("open");
        return { ok: true, value: {} };
      },
      close() {
        events.push("close");
      },
    });
    // A synchronous C callback closes its direct lease before the queued finalizer invokes.
    void ownership.joined((boundary) => {
      void boundary.finalize((async () => {
        events.push("finalize.enter");
        entered.resolve();
        await release.promise;
        events.push("finalize.end");
      }) as unknown as () => undefined);
      events.push("parent.body.end");
    });
    return "root result";
  });
  const actual = observe(run);
  void actual.then(() => entered.resolve());
  let stop: ReturnType<typeof app.stop> | undefined;
  try {
    await bounded(entered.promise);
    assert.deepEqual(events, ["open", "parent.body.end", "finalize.enter"]);
    await pending(run);
    stop = app.stop();
    await pending(stop);
    release.resolve();
    const outcome = await bounded(actual);
    assert.deepEqual(outcome, { ok: true, value: "root result" });
    assert.deepEqual(events, [
      "open",
      "parent.body.end",
      "finalize.enter",
      "finalize.end",
      "close",
    ]);
    assert.equal((await stop).successful, true);
  } finally {
    release.resolve();
    await Promise.allSettled([run, actual, stop]);
    await app.stop();
  }
});
