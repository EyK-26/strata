import { test } from "bun:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { service, valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import {
  type CommandScope,
  createApplication,
  type ExecutionTaskOutcome,
} from "@getstrata/core/runtime/application";
import {
  bounded,
  deferred,
  pending,
  rejected,
  resource,
} from "../fixtures/applicationOwnershipSupport";

function expired(work: () => unknown) {
  assert.throws(
    work,
    (error: unknown) => Reflect.get(error as object, "code") === "APPLICATION_SCOPE_EXPIRED",
  );
}
function failures(error: unknown, expected: unknown[]) {
  assert.ok(
    error instanceof AggregateError,
    "multiple body occurrences require native AggregateError",
  );
  assert.equal(error.message, "Execution task failures.");
  assert.equal(error.cause, expected[0]);
  assert.equal(Object.isFrozen(error), true);
  assert.equal(Object.isFrozen(error.errors), true);
  assert.equal(error.errors.length, expected.length);
  expected.forEach((value, index) => {
    assert.equal(error.errors[index], value);
  });
}

test("joined tasks share one execution graph across descendants, isolate runs/apps, and never run inline", async () => {
  const Value = createServiceToken<{ count: number }>("task value");
  let factories = 0;
  const make = () =>
    createApplication({
      providers: [],
      services: [
        service(Value, {
          lifetime: "execution",
          dependencies: [],
          create: () => ({ count: ++factories }),
        }),
      ],
    });
  const a = make();
  const b = make();
  const seen: object[] = [];
  await Promise.all([a.start(), b.start()]);
  try {
    for (const app of [a, a, b])
      await app.run(async (root) => {
        const value = root.resolve(Value);
        seen.push(value);
        let inline = true;
        const child = root.spawn(async (scope) => {
          assert.equal(inline, false, "spawn must schedule child callback after returning");
          assert.equal(Object.isFrozen(scope), true);
          assert.notEqual(scope, root);
          assert.equal(scope.context, root.context);
          assert.equal(scope.signal, root.signal);
          assert.equal(scope.config, root.config);
          assert.equal(scope.resolve(Value), value);
          value.count++;
          const nested = await scope.spawn((grandchild) => {
            assert.equal(grandchild.resolve(Value), value);
            assert.equal(grandchild.context, root.context);
            return value;
          });
          assert.equal(nested.ok, true);
          return value;
        });
        inline = false;
        const outcome = await child;
        assert.equal(Object.isFrozen(outcome), true);
        assert.equal(outcome.ok, true);
        if (outcome.ok) {
          assert.equal(outcome.value, value);
          assert.equal(Object.isFrozen(value), false, "service payload must remain mutable");
        }
      });
    assert.equal(factories, 3, "spawn must not rerun execution factories");
    assert.equal(new Set(seen).size, 3);
  } finally {
    await Promise.all([a.stop(), b.stop()]);
  }
});

test("body leases close independently while ignored children and later grandchildren actually join", async () => {
  const Value = createServiceToken<number>("lease value");
  const childGate = deferred();
  const grandGate = deferred();
  const grandEntered = deferred();
  const app = createApplication({ providers: [], services: [valueService(Value, 7)] });
  let root!: CommandScope;
  let child!: CommandScope;
  let childResult!: Promise<ExecutionTaskOutcome<number>>;
  await app.start();
  const result = app.run((scope) => {
    root = scope;
    childResult = scope.spawn(async (current) => {
      child = current;
      await childGate.promise;
      assert.equal(current.resolve(Value), 7);
      void current.spawn(async (grandchild) => {
        grandEntered.resolve();
        await grandGate.promise;
        assert.equal(grandchild.resolve(Value), 7);
        return 3;
      });
      return 2;
    });
    return 1;
  });
  try {
    await pending(result);
    expired(() => root.resolve(Value));
    assert.equal(
      Reflect.get((await rejected(root.spawn(() => 9))) as object, "code"),
      "APPLICATION_SCOPE_EXPIRED",
    );
    childGate.resolve();
    await bounded(grandEntered.promise);
    expired(() => child.resolve(Value));
    await pending(childResult);
    await pending(result);
    grandGate.resolve();
    assert.deepEqual(await childResult, { ok: true, value: 2 });
    assert.equal(await result, 1);
  } finally {
    childGate.resolve();
    grandGate.resolve();
    await app.stop();
  }
});

for (const mode of ["ignored", "awaited", "fallback", "rethrow"] as const)
  test(`child falsy failure is retained when ${mode}`, async () => {
    const app = createApplication({ providers: [] });
    await app.start();
    try {
      for (const reason of [undefined, null, false, 0, ""]) {
        const result = app.run(async (scope) => {
          const observation = scope.spawn(() => {
            throw reason;
          });
          if (mode === "ignored") return 1;
          const outcome = await observation;
          assert.equal(Object.isFrozen(outcome), true);
          assert.equal(outcome.ok, false);
          if (outcome.ok) assert.fail("failed child produced success");
          assert.equal(outcome.error, reason);
          if (mode === "rethrow") throw outcome.error;
          return mode === "fallback" ? 99 : outcome;
        });
        const error = await rejected(result);
        if (mode === "rethrow") failures(error, [reason, reason]);
        else assert.equal(error, reason, "observing failed outcome cannot recover execution");
      }
      assert.equal(app.state.errors.length, 0);
    } finally {
      assert.equal((await app.stop()).successful, true);
    }
  });

test("opaque failures are never inspected, frozen, deduplicated or flattened", async () => {
  const app = createApplication({ providers: [] });
  const opaque = new Proxy(
    {},
    {
      get() {
        assert.fail("opaque error getter inspected");
      },
      getPrototypeOf() {
        assert.fail("opaque error prototype inspected");
      },
      ownKeys() {
        assert.fail("opaque error keys inspected");
      },
      preventExtensions() {
        assert.fail("opaque error frozen");
      },
    },
  );
  const caller = new AggregateError([0], "caller");
  await app.start();
  try {
    const opaqueResult = await app
      .run((scope) => {
        void scope.spawn(() => {
          throw opaque;
        });
      })
      .then(
        () => assert.fail("opaque child failure was lost"),
        (error: unknown) => ({ error }),
      );
    assert.equal(opaqueResult.error, opaque);
    const error = await rejected(
      app.run((scope) => {
        void scope.spawn(() => {
          throw caller;
        });
        void scope.spawn(() => {
          throw caller;
        });
      }),
    );
    failures(error, [caller, caller]);
    assert.equal(Object.isFrozen(caller), false);
    assert.equal(Object.isFrozen(caller.errors), false);
    caller.errors.push(1);
    assert.deepEqual(caller.errors, [0, 1]);
  } finally {
    await app.stop();
  }
});

test("recursive failure preorder and private occurrences survive public subtree summary observation", async () => {
  const app = createApplication({ providers: [] });
  const enter = deferred();
  const gate = deferred();
  const rootError = { name: "root" };
  const a = { name: "A" };
  const a1 = { name: "A1" };
  const b = { name: "B" };
  await app.start();
  try {
    const result = app.run(async (root) => {
      const child = root.spawn(async (scope) => {
        await gate.promise;
        void scope.spawn(() => {
          throw a1;
        });
        throw a;
      });
      void root.spawn(() => {
        enter.resolve();
        throw b;
      });
      await enter.promise;
      gate.resolve();
      const summary = await child;
      assert.equal(summary.ok, false);
      if (summary.ok) assert.fail("subtree must fail");
      failures(summary.error, [a, a1]);
      assert.throws(() => (summary.error as AggregateError).errors.reverse());
      throw rootError;
    });
    failures(await rejected(result), [rootError, a, a1, b]);
    assert.equal(Object.isFrozen(a), false);
    for (const rethrow of [false, true]) {
      let summary: unknown;
      const error = await rejected(
        app.run(async (root) => {
          const outcome = await root.spawn((scope) => {
            void scope.spawn(() => {
              throw a1;
            });
            throw a;
          });
          if (outcome.ok) assert.fail("subtree must fail");
          summary = outcome.error;
          if (rethrow) throw summary;
          return outcome;
        }),
      );
      failures(error, rethrow ? [summary, a, a1] : [a, a1]);
      assert.notEqual(
        error,
        summary,
        "ancestor reconstructs a fresh summary from private occurrences",
      );
    }
  } finally {
    gate.resolve();
    await app.stop();
  }
});

test("native thenables assimilate once and close lease before observers; noncallable then values stay exact", async () => {
  const app = createApplication({ providers: [] });
  const Token = createServiceToken<number>("absent");
  let reads = 0;
  let calls = 0;
  let saved!: CommandScope;
  let finish!: (value: number) => void;
  const entered = deferred();
  await app.start();
  try {
    const result = app.run((root) =>
      root.spawn((scope) => {
        saved = scope;
        // biome-ignore lint/suspicious/noThenProperty: Exercise native thenable assimilation.
        return Object.defineProperty({}, "then", {
          get() {
            reads++;
            return (resolve: (value: number) => void) => {
              calls++;
              finish = resolve;
              entered.resolve();
            };
          },
        }) as Promise<number>;
      }),
    );
    await bounded(entered.promise);
    assert.equal(reads, 1, "then getter must be read only once");
    assert.equal(calls, 1, "thenable must be assimilated only once");
    finish(7);
    const outcome = await result;
    assert.deepEqual(outcome, { ok: true, value: 7 });
    expired(() => saved.resolve(Token));
    // biome-ignore lint/suspicious/noThenProperty: Noncallable then is an ordinary payload.
    const value = { then: 7, mutable: true };
    const plain = await app.run((root) => root.spawn(() => value));
    assert.equal(plain.ok, true);
    if (plain.ok) assert.equal(plain.value, value);
    assert.equal(Object.isFrozen(value), false);
    let queued!: Promise<unknown>;
    await app.run((root) =>
      root.spawn((scope) => {
        queued = Promise.resolve().then(() => {
          expired(() => scope.resolve(Token));
          return rejected(scope.spawn(() => 1));
        });
        return 1;
      }),
    );
    assert.equal(Reflect.get((await queued) as object, "code"), "APPLICATION_SCOPE_EXPIRED");
  } finally {
    finish?.(7);
    await app.stop();
  }
});

test("actual grandchild settlement holds backing flush/close beyond stop deadline after producer drain", async () => {
  const events: string[] = [];
  const entered = deferred();
  const gate = deferred();
  const drained = deferred();
  const app = createApplication({
    shutdownTimeoutMs: 20,
    providers: [
      {
        name: "infra",
        async setup(scope) {
          await scope.acquire(
            resource("backing", events, {
              drain() {
                events.push("backing.drain");
                drained.resolve();
              },
            }),
          );
        },
      },
    ],
  });
  await app.start();
  const result = app.run((root) => {
    void root.spawn((child) => {
      void child.spawn(async () => {
        entered.resolve();
        await gate.promise;
        events.push("grandchild.done");
      });
    });
    throw 0;
  });
  const failure = rejected(result);
  try {
    await bounded(entered.promise);
    const stop = app.stop();
    await bounded(drained.promise);
    assert.equal((await bounded(stop)).timedOut, true);
    await pending(result);
    await pending(app.completion);
    assert.equal(events.includes("backing.flush"), false, "grandchild must hold backing flush");
    assert.equal(events.includes("backing.close"), false, "grandchild must hold backing close");
    gate.resolve();
    assert.equal(await failure, 0);
    assert.equal((await bounded(app.completion)).successful, true);
    assert.ok(events.indexOf("backing.drain") < events.indexOf("grandchild.done"));
    assert.ok(events.indexOf("grandchild.done") < events.indexOf("backing.flush"));
    assert.ok(events.indexOf("backing.flush") < events.indexOf("backing.close"));
  } finally {
    gate.resolve();
    await bounded(app.completion);
  }
});

test("failed admission has no phantom occurrence while reserved cancellation skips and records child", async () => {
  const app = createApplication({ providers: [] });
  await app.start();
  try {
    await app.run(async (scope) => {
      assert.ok((await rejected(scope.spawn(0 as never))) instanceof TypeError);
      return 1;
    });
    const external = new AbortController();
    let calls = 0;
    let observation!: Promise<ExecutionTaskOutcome<number>>;
    const error = await rejected(
      app.run({ kind: "command", signal: external.signal }, async (root) => {
        observation = root.spawn(() => {
          calls++;
          return 3;
        });
        external.abort(false);
        assert.equal(
          await rejected(
            root.spawn(() => {
              calls++;
            }),
          ),
          false,
        );
        return 2;
      }),
    );
    assert.equal(error, false, "only admitted skipped child contributes an occurrence");
    assert.deepEqual(await observation, { ok: false, error: false });
    assert.equal(calls, 0);
  } finally {
    await app.stop();
  }
});

test("active child keeps resolver after cancellation and first reason forbids new admission", async () => {
  const external = new AbortController();
  const gate = deferred();
  const entered = deferred();
  const Value = createServiceToken<number>("cancel value");
  const app = createApplication({ providers: [], services: [valueService(Value, 7)] });
  await app.start();
  const result = app.run({ kind: "command", signal: external.signal }, (root) => {
    void root.spawn(async (child) => {
      entered.resolve();
      await gate.promise;
      assert.equal(child.signal.reason, null);
      assert.equal(child.resolve(Value), 7);
      assert.equal(await rejected(child.spawn(() => 1)), null);
      return 4;
    });
    return 1;
  });
  try {
    await bounded(entered.promise);
    external.abort(null);
    const stop = app.stop();
    await pending(result);
    gate.resolve();
    assert.equal(await result, 1, "cancelled active callback retains actual success");
    assert.equal((await bounded(stop)).successful, true);
  } finally {
    gate.resolve();
    await app.stop();
  }
});

for (const at of ["admission", "invocation"] as const)
  test(`task deadline refresh observes clock expiry at ${at} before timer dispatch`, async () => {
    const app = createApplication({ providers: [] });
    const realNow = Date.now;
    let now = 1000;
    let calls = 0;
    await app.start();
    try {
      Date.now = () => now;
      const result = app.run({ kind: "command", deadlineAtMs: 2000 }, async (root) => {
        if (at === "admission") now = 3000;
        const observation = root.spawn(() => {
          calls++;
        });
        if (at === "invocation") now = 3000;
        if (at === "admission") {
          assert.equal(
            Reflect.get((await rejected(observation)) as object, "code"),
            "EXECUTION_DEADLINE",
          );
        } else {
          const outcome = await observation;
          if (outcome.ok) assert.fail("expired reserved child must fail");
          assert.equal(Reflect.get(outcome.error as object, "code"), "EXECUTION_DEADLINE");
        }
        return 1;
      });
      if (at === "admission")
        assert.equal(await result, 1, "rejected admission creates no phantom failure");
      else
        assert.equal(Reflect.get((await rejected(result)) as object, "code"), "EXECUTION_DEADLINE");
      assert.equal(calls, 0, "expired deadline must prevent child callback");
    } finally {
      Date.now = realNow;
      await app.stop();
    }
  });

test("root failure retains external listeners and deadline timer until entire tree disposes once", async () => {
  const app = createApplication({ providers: [] });
  const external = new AbortController();
  const gate = deferred();
  const entered = deferred();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const owned = new Set<ReturnType<typeof setTimeout>>();
  const clears = new Map<ReturnType<typeof setTimeout>, number>();
  let signal!: AbortSignal;
  await app.start();
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const timer = realSet(callback, delay, ...args);
    if (delay === 100000) owned.add(timer);
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    if (owned.has(timer)) clears.set(timer, (clears.get(timer) ?? 0) + 1);
    realClear(timer);
  }) as typeof clearTimeout;
  const realNow = Date.now;
  const now = realNow();
  Date.now = () => now;
  const result = app.run(
    { kind: "command", signal: external.signal, deadlineAtMs: now + 100000 },
    (root) => {
      signal = root.signal;
      void root.spawn(async () => {
        entered.resolve();
        await gate.promise;
      });
      throw 0;
    },
  );
  Date.now = realNow;
  const failure = rejected(result);
  try {
    await bounded(entered.promise);
    assert.equal(owned.size, 1);
    assert.equal(clears.size, 0, "root body failure must retain tree deadline timer");
    assert.equal(
      getEventListeners(external.signal, "abort").length,
      1,
      "root failure must retain external subscription",
    );
    external.abort(false);
    assert.equal(signal.reason, false, "live descendants must still receive external cancellation");
    await pending(result);
    gate.resolve();
    assert.equal(await failure, 0);
    assert.equal(getEventListeners(external.signal, "abort").length, 0);
    for (const timer of owned)
      assert.equal(clears.get(timer), 1, "tree deadline timer must clear exactly once");
    await app.stop();
    assert.equal(signal.reason, false);
  } finally {
    Date.now = realNow;
    gate.resolve();
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
    for (const timer of owned) realClear(timer);
    await app.stop();
  }
});
