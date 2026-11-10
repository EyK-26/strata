import { test } from "bun:test";
import assert from "node:assert/strict";
import { resourceService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import {
  type CleanupContext,
  type CommandScope,
  createApplication,
  type ExecutionTaskOutcome,
  type OpenOutcome,
  type ResourceSpec,
} from "@getstrata/core/runtime/application";
import {
  bounded,
  deferred,
  pending,
  rejected,
  resource,
} from "../fixtures/applicationOwnershipSupport";

function occurrences(error: unknown, expected: readonly unknown[]) {
  if (expected.length === 1) {
    assert.equal(error, expected[0], "single task resource failure preserves opaque identity");
    return;
  }
  assert.ok(
    error instanceof AggregateError,
    "multiple task resource occurrences require an owner aggregate",
  );
  assert.equal(Object.isFrozen(error), true);
  assert.equal(Object.isFrozen(error.errors), true);
  assert.equal(error.cause, expected[0]);
  assert.equal(
    error.errors.length,
    expected.length,
    "task resource occurrence multiplicity is exact",
  );
  expected.forEach((value, index) => {
    assert.equal(
      error.errors[index],
      value,
      "task resource occurrences follow private reservation preorder",
    );
  });
}

function failureSpec(
  name: string,
  error: unknown,
  cleanupErrors?: readonly unknown[],
): ResourceSpec<string> {
  return {
    name,
    open: () => ({
      ok: false,
      error,
      disposition: cleanupErrors ? "cleaned" : "not-acquired",
      ...(cleanupErrors ? { cleanupErrors } : {}),
    }),
    close() {
      assert.fail("discharged acquisition has no handle");
    },
  };
}

test("task resources follow actual descendants and close before child outcome and root run", async () => {
  const events: string[] = [];
  const grandEntered = deferred();
  const grandRelease = deferred();
  const rootClose = deferred();
  const rootCloseRelease = deferred();
  const app = createApplication({ providers: [] });
  let root!: CommandScope;
  let child!: CommandScope;
  let childOutcome!: Promise<ExecutionTaskOutcome<string>>;
  const contexts: CleanupContext[] = [];
  await app.start();
  const run = app.run(async (scope) => {
    root = scope;
    assert.equal(Object.isFrozen(scope), true);
    const ancestor = await scope.acquire(
      resource("root", events, {
        async close(_value, context) {
          contexts.push(context);
          events.push("root.close");
          rootClose.resolve();
          await rootCloseRelease.promise;
        },
      }),
    );
    childOutcome = scope.spawn(async (current) => {
      child = current;
      assert.equal(current.context, scope.context);
      await current.acquire(
        resource("child", events, {
          close(_value, context) {
            contexts.push(context);
            events.push("child.close");
          },
        }),
      );
      void current.spawn(async (grandchild) => {
        assert.equal(ancestor, "root");
        assert.equal(grandchild.context, scope.context);
        grandEntered.resolve();
        await grandRelease.promise;
        return grandchild.acquire(resource("grandchild", events));
      });
      return "child result";
    });
    return "root result";
  });
  try {
    await bounded(grandEntered.promise);
    await pending(run);
    await pending(childOutcome);
    for (const expired of [root, child]) {
      const error = await rejected(
        expired.acquire(resource(expired === root ? "expired-root" : "expired-child", events)),
      );
      assert.ok(error instanceof Error);
      assert.equal(
        Reflect.get(error, "code"),
        "APPLICATION_SCOPE_EXPIRED",
        "expired task acquire retains exact lease diagnostic",
      );
    }
    assert.equal(
      events.some((event) => event.endsWith(".close")),
      false,
      "ancestor resource stays live beneath actual grandchild",
    );
    grandRelease.resolve();
    assert.deepEqual(await bounded(childOutcome), { ok: true, value: "child result" });
    assert.equal(
      events.includes("child.close"),
      true,
      "child resource cleanup precedes public child outcome",
    );
    await bounded(rootClose.promise);
    await pending(run);
    assert.equal(events.includes("expired-root.open"), false);
    assert.equal(events.includes("expired-child.open"), false);
    rootCloseRelease.resolve();
    assert.equal(
      await bounded(run),
      "root result",
      "root run waits actual selected close settlement",
    );
    assert.deepEqual(
      events.filter((event) => event.endsWith(".close")),
      ["grandchild.close", "child.close", "root.close"],
    );
    for (const context of contexts) {
      assert.equal(context.reason, "task-complete");
      assert.equal(context.signal.aborted, false, "normal cleanup signal is live");
      assert.notEqual(context.signal, root.signal, "cleanup does not reuse execution signal");
      assert.equal(Object.isFrozen(context), true);
    }
  } finally {
    grandRelease.resolve();
    rootCloseRelease.resolve();
    await app.stop();
  }
});

for (const caught of [true, false]) {
  test(`task admitted acquisition failure stays strict when ${caught ? "caught" : "awaited uncaught"}`, async () => {
    const app = createApplication({ providers: [] });
    const marker = undefined;
    await app.start();
    const error = await rejected(
      app.run(async (scope) => {
        const acquisition = scope.acquire(failureSpec("same", marker));
        if (caught) {
          await acquisition.catch(() => "fallback");
          return "fallback";
        }
        return await acquisition;
      }),
    );
    occurrences(error, caught ? [marker] : [marker, marker]);
    assert.equal(app.state.phase, "ready");
    assert.equal(
      (await app.stop()).successful,
      true,
      "discharged task acquisition failure does not dirty application cleanup",
    );
  });
}

test("task resource ledger orders body acquisition child and cleanup occurrences without equality dedup", async () => {
  const events: string[] = [];
  const same = Symbol("same body and open error");
  const opaque = new AggregateError(["caller entry"], "caller aggregate");
  const internal = Symbol("internal acquisition cleanup");
  const flush = Symbol("flush");
  const first = deferred<OpenOutcome<string>>();
  const second = deferred<OpenOutcome<string>>();
  const admitted = deferred();
  let child!: Promise<ExecutionTaskOutcome<never>>;
  const app = createApplication({ providers: [] });
  await app.start();
  const run = app.run(async (scope) => {
    await scope.acquire(
      resource("owned", events, {
        flush() {
          throw flush;
        },
      }),
    );
    void scope.acquire({
      name: "first",
      open: () => first.promise,
      close() {
        assert.fail("no handle");
      },
    });
    void scope.acquire({
      name: "second",
      open: () => second.promise,
      close() {
        assert.fail("no handle");
      },
    });
    child = scope.spawn(async (current) => {
      await current.acquire(failureSpec("child", opaque)).catch(() => {});
      throw null;
    });
    admitted.resolve();
    throw same;
  });
  await bounded(admitted.promise);
  second.resolve({ ok: false, error: undefined, disposition: "not-acquired" });
  first.resolve({ ok: false, error: same, disposition: "cleaned", cleanupErrors: [internal] });
  const childResult = await bounded(child);
  assert.equal(childResult.ok, false);
  if (!childResult.ok) occurrences(childResult.error, [null, opaque]);
  occurrences(await rejected(run), [same, same, undefined, null, opaque, internal, flush]);
  assert.equal(Object.isFrozen(opaque), false, "caller aggregate remains caller-owned");
  assert.deepEqual(opaque.errors, ["caller entry"]);
  assert.equal(events.filter((event) => event === "owned.close").length, 1);
  const done = await app.stop();
  assert.equal(done.successful, false);
  assert.deepEqual(
    done.snapshot.retainedResources,
    [],
    "failed cleanup can coexist with released task ownership",
  );
});

test("caught invalid duplicate and expired task admission create no phantom acquisition occurrence", async () => {
  const events: string[] = [];
  const app = createApplication({ providers: [] });
  const external = new AbortController();
  let opens = 0;
  await app.start();
  const result = await app.run({ kind: "command", signal: external.signal }, async (scope) => {
    await scope.acquire(resource("same", events));
    await rejected(
      scope.acquire({
        name: "same",
        open() {
          opens++;
          return { ok: true, value: "duplicate" };
        },
        close() {},
      }),
    );
    const invalid = Object.defineProperty({ name: "invalid", close() {} }, "open", {
      get() {
        assert.fail("invalid spec getter must not execute");
      },
    });
    await rejected(scope.acquire(invalid as unknown as ResourceSpec<string>));
    const reflection = new Proxy(resource("reflection", events), {
      getOwnPropertyDescriptor(target, key) {
        if (key === "name") external.abort(Symbol("descriptor cancellation"));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    await rejected(scope.acquire(reflection));
    return 7;
  });
  assert.equal(result, 7, "caught pre-admission failures do not fail the resource owner");
  assert.equal(opens, 0);
  assert.equal(
    events.includes("reflection.open"),
    false,
    "spec reflection cancellation prevents reservation and open",
  );
  assert.equal(events.filter((event) => event === "same.close").length, 1);
  assert.equal((await app.stop()).successful, true);
});

for (const mode of ["unknown", "close"] as const) {
  test(`retained task ${mode} keeps empty ancestor metadata and all application backing`, async () => {
    const events: string[] = [];
    const marker = Symbol(mode);
    const Managed = createServiceToken<string>("managed");
    const app = createApplication({
      services: [
        resourceService(Managed, {
          lifetime: "application",
          dependencies: [],
          create: () => resource("managed", events),
        }),
      ],
      providers: [
        {
          name: "provider",
          async setup(scope) {
            await scope.acquire(resource("provider", events));
          },
        },
      ],
      transports: [
        {
          name: "transport",
          async setup(scope) {
            await scope.acquire(resource("transport", events));
          },
        },
      ],
    });
    await app.start();
    const run = app.run(async (root) => {
      const child = await root.spawn(async (empty) => {
        return empty.spawn(async (leaf) => {
          if (mode === "unknown")
            await leaf
              .acquire({
                name: "retained",
                open: () => ({ ok: false, error: marker, disposition: "unknown" }),
                close() {
                  assert.fail("unknown has no handle");
                },
              })
              .catch(() => {});
          else
            await leaf.acquire(
              resource("retained", events, {
                close() {
                  events.push("retained.close");
                  throw marker;
                },
              }),
            );
        });
      });
      assert.equal(child.ok, false);
    });
    occurrences(await rejected(run), [marker]);
    assert.equal(app.state.phase, "ready");
    for (let index = 0; index < 8; index++)
      await app.run(async (scope) => {
        assert.equal(scope.resolve(Managed), "managed");
        await scope.acquire(resource(`safe${index}`, events));
      });
    assert.equal(
      events.filter((event) => /^safe\d+\.close$/.test(event)).length,
      8,
      "independent selected cleanup proceeds beside retained task ownership",
    );
    const done = await bounded(app.stop());
    assert.equal(done.successful, false);
    if (mode === "unknown")
      assert.ok(
        done.snapshot.errors.some(
          (entry) => entry.kind === "acquisition" && entry.error === marker,
        ),
        "retained unknown task acquisition preserves opaque diagnostic identity",
      );
    for (const name of ["managed", "provider", "transport"])
      assert.equal(
        events.includes(`${name}.close`),
        false,
        "empty ancestor chain preserves every application backing obligation",
      );
    assert.equal(
      events.filter((event) => event === "retained.close").length,
      mode === "close" ? 1 : 0,
      "retained task close is not retried by application stop",
    );
    assert.deepEqual([...done.snapshot.retainedResources].sort(), [
      "managed",
      "provider",
      "retained",
      "transport",
    ]);
  });
}

for (const phase of ["stop", "drain"] as const) {
  test(`task ${phase} failure stays unsafe across selected cleanup and later application stop`, async () => {
    const events: string[] = [];
    const marker = Symbol(phase);
    let attempts = 0;
    const app = createApplication({
      providers: [
        {
          name: "backing",
          async setup(scope) {
            await scope.acquire(resource("backing", events));
          },
        },
      ],
    });
    await app.start();
    occurrences(
      await rejected(
        app.run(async (scope) => {
          await scope.acquire(
            resource("task", events, {
              [phase]() {
                attempts++;
                throw marker;
              },
            }),
          );
        }),
      ),
      [marker],
    );
    await app.run((scope) => scope.acquire(resource("independent", events)));
    assert.equal(
      events.includes("independent.close"),
      true,
      "safe independent selected group can finish after sticky phase failure",
    );
    const done = await bounded(app.stop());
    assert.equal(done.successful, false);
    assert.equal(attempts, 1, "failed task lifecycle phase is shared and never retried");
    assert.equal(
      events.includes("task.close"),
      false,
      "failed task stop or drain blocks own close",
    );
    assert.equal(
      events.includes("backing.close"),
      false,
      "historical task stop or drain failure keeps global unsafe barrier",
    );
  });
}

test("global drain waits late task producer whose selected stop began after the global snapshot", async () => {
  const events: string[] = [];
  const opening = deferred();
  const outcome = deferred<OpenOutcome<string>>();
  const backingStop = deferred();
  const backingRelease = deferred();
  const taskStop = deferred();
  const taskRelease = deferred();
  let lateContext!: CleanupContext;
  let executionSignal!: AbortSignal;
  const app = createApplication({
    shutdownTimeoutMs: 20,
    providers: [
      {
        name: "backing",
        async setup(scope) {
          await scope.acquire(
            resource("backing", events, {
              async stop() {
                events.push("backing.stop");
                backingStop.resolve();
                await backingRelease.promise;
              },
            }),
          );
        },
      },
    ],
  });
  await app.start();
  const run = app.run((scope) => {
    executionSignal = scope.signal;
    void scope.acquire(
      resource("late", events, {
        open() {
          opening.resolve();
          return outcome.promise;
        },
        async stop(_value, context) {
          lateContext = context;
          events.push("late.stop");
          taskStop.resolve();
          await taskRelease.promise;
        },
      }),
    );
  });
  try {
    await bounded(opening.promise);
    const stop = app.stop({ reason: "global-stop" });
    await bounded(backingStop.promise);
    outcome.resolve({ ok: true, value: "late" });
    await bounded(taskStop.promise);
    backingRelease.resolve();
    await pending(run);
    await pending(app.completion);
    assert.equal(
      events.includes("backing.drain"),
      false,
      "global drain waits late selected stop actual settlement",
    );
    assert.equal(
      lateContext.reason,
      "task-complete",
      "first selected stop context wins over global caller",
    );
    assert.notEqual(lateContext.signal, executionSignal);
    const timed = await bounded(stop);
    assert.equal(timed.timedOut, true);
    assert.equal(events.includes("backing.close"), false);
    taskRelease.resolve();
    await rejected(run);
    const done = await bounded(app.completion);
    assert.equal(done.snapshot.cleanup, "clean");
    assert.equal(
      events.filter((event) => event === "late.stop").length,
      1,
      "concurrent global and selected stop share one actual hook",
    );
    assert.deepEqual(
      events.filter((event) => event.endsWith(".close")),
      ["late.close", "backing.close"],
    );
  } finally {
    backingRelease.resolve();
    taskRelease.resolve();
    outcome.resolve({ ok: false, error: "recovery", disposition: "not-acquired" });
    await app.stop();
  }
});

for (const phase of ["drain", "close"] as const) {
  test(`concurrent application stop shares pending selected task ${phase} until actual rejection`, async () => {
    const events: string[] = [];
    const entered = deferred();
    const release = deferred();
    const marker = Symbol(phase);
    let count = 0;
    let context!: CleanupContext;
    const app = createApplication({
      shutdownTimeoutMs: 20,
      providers: [
        {
          name: "backing",
          async setup(scope) {
            await scope.acquire(resource("backing", events));
          },
        },
      ],
    });
    await app.start();
    const run = app.run((scope) =>
      scope.acquire(
        resource("task", events, {
          async [phase](_value: string, current: CleanupContext) {
            count++;
            context = current;
            entered.resolve();
            await release.promise;
            throw marker;
          },
        }),
      ),
    );
    try {
      await bounded(entered.promise);
      const stop = app.stop({ reason: "global" });
      await pending(run);
      await pending(app.completion);
      assert.equal(
        events.includes("backing.close"),
        false,
        "application backing cannot close under pending selected hook",
      );
      assert.equal(context.reason, "task-complete");
      const timed = await bounded(stop);
      assert.equal(timed.timedOut, true);
      release.resolve();
      occurrences(await rejected(run), [marker]);
      const done = await bounded(app.completion);
      assert.equal(
        count,
        1,
        "selected and global phase attempt coalesces through actual rejection",
      );
      assert.equal(
        done.snapshot.errors.filter((entry) => entry.kind === "cleanup" && entry.error === marker)
          .length,
        1,
        "coalesced task cleanup creates one application diagnostic",
      );
      assert.equal(done.successful, false);
      assert.equal(events.includes("backing.close"), false);
    } finally {
      release.resolve();
      await app.stop();
    }
  });
}

for (const kind of ["getter", "callable"] as const) {
  test(`task acquired ${kind} then payload validates before assimilation and disposes original handle`, async () => {
    let reads = 0;
    let closed: object | undefined;
    let observed: unknown;
    const handle =
      kind === "getter"
        ? // biome-ignore lint/suspicious/noThenProperty: Hostile then accessor deliberately tests acquisition validation before assimilation.
          Object.defineProperty({}, "then", {
            get() {
              reads++;
              throw new Error("must not assimilate");
            },
          })
        : {
            // biome-ignore lint/suspicious/noThenProperty: Nonsettling then deliberately tests that acquired handles are validated before assimilation.
            then() {
              reads++;
            },
          };
    const app = createApplication({ providers: [] });
    await app.start();
    const error = await rejected(
      app.run(async (scope) => {
        await scope
          .acquire<object>({
            name: "hostile",
            open: () => ({ ok: true, value: handle }),
            close(value) {
              closed = value;
            },
          })
          .catch((error: unknown) => {
            observed = error;
          });
      }),
    );
    assert.equal(reads, 0, "task payload validation prevents native then assimilation");
    assert.ok(error instanceof TypeError);
    assert.equal(error, observed);
    assert.equal(
      closed,
      handle,
      "invalid task payload cleanup receives original known acquired handle",
    );
    assert.equal((await app.stop()).successful, true);
  });
}

for (const boundary of ["admission", "publication"] as const) {
  test(`task acquire checks clock-expired deadline at ${boundary} before timer dispatch`, async () => {
    const originalNow = Date.now;
    let clock = originalNow();
    let opens = 0;
    let closed: object | undefined;
    let caught: unknown;
    const app = createApplication({ providers: [] });
    await app.start();
    Date.now = () => clock;
    try {
      const deadline = clock + 1000;
      const handle = new Proxy(
        {},
        {
          getOwnPropertyDescriptor(target, key) {
            if (boundary === "publication" && key === "then") clock = deadline + 1;
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        },
      );
      const spec = new Proxy<ResourceSpec<object>>(
        {
          name: "deadline",
          open() {
            opens++;
            return { ok: true, value: handle };
          },
          close(value, context) {
            closed = value;
            assert.equal(
              context.signal.aborted,
              false,
              "execution deadline does not pre-abort actual cleanup signal",
            );
            assert.equal(context.reason, "task-complete");
          },
        },
        {
          getOwnPropertyDescriptor(target, key) {
            if (boundary === "admission" && key === "name") clock = deadline + 1;
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        },
      );
      const run = app.run({ kind: "command", deadlineAtMs: deadline }, async (scope) => {
        await scope.acquire(spec).catch((error: unknown) => {
          caught = error;
        });
        return 7;
      });
      if (boundary === "admission")
        assert.equal(
          await bounded(run),
          7,
          "caught clock-expired nonadmission has no phantom occurrence",
        );
      else
        assert.equal(
          await rejected(run),
          caught,
          "clock-expired admitted publication contributes exact acquisition failure",
        );
      assert.ok(caught instanceof Error);
      assert.equal(Reflect.get(caught, "code"), "EXECUTION_DEADLINE");
      assert.equal(
        opens,
        boundary === "admission" ? 0 : 1,
        "elapsed deadline prevents task acquisition at the correct admission boundary",
      );
      assert.equal(
        closed,
        boundary === "publication" ? handle : undefined,
        "elapsed publication deadline keeps actual acquired handle for cleanup",
      );
    } finally {
      Date.now = originalNow;
      await app.stop();
    }
  });
}

test("disposed task flush failure survives later clean history while body-only failures leave cleanup clean", async () => {
  const events: string[] = [];
  const flush = Symbol("task flush");
  const app = createApplication({ providers: [] });
  await app.start();
  occurrences(
    await rejected(
      app.run(async (scope) => {
        await scope.acquire(
          resource("flush", events, {
            flush() {
              throw flush;
            },
          }),
        );
      }),
    ),
    [flush],
  );
  assert.equal(events.filter((event) => event === "flush.close").length, 1);
  for (let index = 0; index < 12; index++)
    await app.run((scope) => scope.acquire(resource(`clean${index}`, events)));
  const done = await app.stop();
  assert.equal(
    done.successful,
    false,
    "pruning disposed task ownership cannot erase cleanup failure history",
  );
  assert.deepEqual(done.snapshot.retainedResources, []);
  assert.equal(
    done.snapshot.errors.filter((entry) => entry.kind === "cleanup" && entry.error === flush)
      .length,
    1,
  );
  const bodyOnly = createApplication({ providers: [] });
  await bodyOnly.start();
  const marker = Symbol("body only");
  assert.equal(
    await rejected(
      bodyOnly.run(() => {
        throw marker;
      }),
    ),
    marker,
  );
  assert.equal(
    (await bodyOnly.stop()).successful,
    true,
    "ordinary body failure does not dirty application cleanup",
  );
});

test("task sibling and application resource labels stay private while admitted hooks stay captured", async () => {
  const opened: object[] = [];
  const closed: object[] = [];
  const make = () => createApplication({ providers: [] });
  const a = make();
  const b = make();
  await Promise.all([a.start(), b.start()]);
  try {
    await Promise.all(
      [a, b].map((app) =>
        app.run(async (root) => {
          const children = [0, 1].map((branch) =>
            root.spawn(async (child) => {
              const handle = { applicationId: child.applicationId, branch };
              const spec: ResourceSpec<typeof handle> = {
                name: "same",
                open() {
                  opened.push(handle);
                  return { ok: true, value: handle };
                },
                close(value) {
                  closed.push(value);
                },
              };
              const acquisition = child.acquire(spec);
              // Runtime mutation cannot replace already-captured cleanup authority.
              Object.assign(spec, {
                close() {
                  assert.fail("mutated hook cannot replace admitted cleanup");
                },
              });
              assert.equal(await acquisition, handle);
              return handle;
            }),
          );
          for (const outcome of await Promise.all(children)) {
            assert.equal(outcome.ok, true);
            if (outcome.ok)
              assert.equal(
                closed.includes(outcome.value),
                true,
                "returned child handle is disposed before its outcome",
              );
          }
        }),
      ),
    );
    assert.equal(opened.length, 4);
    assert.equal(
      closed.length,
      4,
      "task identity preserves one close per admitted sibling and application handle",
    );
    assert.deepEqual(
      new Set(closed),
      new Set(opened),
      "equal task resource labels never overwrite another private reservation",
    );
  } finally {
    await Promise.all([a.stop(), b.stop()]);
  }
});

test("reentrant task descriptor cannot admit duplicate resource name within its owner", async () => {
  const events: string[] = [];
  const app = createApplication({ providers: [] });
  await app.start();
  try {
    const result = await app.run(async (scope) => {
      let inner: Promise<string> | undefined;
      let reentered = false;
      const outer = new Proxy(resource("same", events), {
        getOwnPropertyDescriptor(target, key) {
          if (key === "open" && !reentered) {
            reentered = true;
            inner = scope.acquire(resource("same", events));
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const attempted = await scope.acquire(outer).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      assert.equal(
        attempted.ok,
        false,
        "reentrant descriptor cannot admit duplicate resource name",
      );
      if (!attempted.ok) {
        assert.ok(attempted.error instanceof Error);
        assert.match(attempted.error.message, /Duplicate resource name/);
      }
      assert.ok(inner);
      assert.equal(await inner, "same");
      return 7;
    });
    assert.equal(result, 7, "reentrant duplicate nonadmission creates no task failure occurrence");
    assert.equal(
      events.filter((event) => event === "same.open").length,
      1,
      "reentrant duplicate opens only its first reservation",
    );
    assert.equal(events.filter((event) => event === "same.close").length, 1);
  } finally {
    await app.stop();
  }
});

test("selected task finalization waits global-owned drain before close and outcome", async () => {
  const events: string[] = [];
  const bodyEntered = deferred();
  const bodyRelease = deferred();
  const drainEntered = deferred();
  const drainRelease = deferred();
  const marker = Symbol("global drain rejection");
  let drains = 0;
  let drainContext!: CleanupContext;
  const app = createApplication({
    shutdownTimeoutMs: 20,
    providers: [
      {
        name: "backing",
        async setup(scope) {
          await scope.acquire(resource("backing", events));
        },
      },
    ],
  });
  await app.start();
  const run = app.run(async (scope) => {
    await scope.acquire(
      resource("task", events, {
        async drain(_value, context) {
          drains++;
          drainContext = context;
          drainEntered.resolve();
          await drainRelease.promise;
          throw marker;
        },
      }),
    );
    bodyEntered.resolve();
    await bodyRelease.promise;
  });
  try {
    await bounded(bodyEntered.promise);
    const stop = app.stop({ reason: "global-first" });
    await bounded(drainEntered.promise);
    bodyRelease.resolve();
    await pending(run);
    assert.equal(
      events.includes("task.close"),
      false,
      "selected close waits global-owned drain actual settlement",
    );
    assert.equal(
      events.includes("task.flush"),
      false,
      "selected flush cannot overtake global-owned drain",
    );
    assert.equal(
      drainContext.reason,
      "global-first",
      "global-owned drain preserves its first caller context",
    );
    assert.equal((await bounded(stop)).timedOut, true);
    drainRelease.resolve();
    occurrences(await rejected(run), [marker]);
    const done = await bounded(app.completion);
    assert.equal(drains, 1, "global-owned drain has one actual attempt and occurrence");
    assert.equal(events.includes("task.close"), false);
    assert.equal(events.includes("backing.close"), false);
    assert.equal(
      done.snapshot.errors.filter((entry) => entry.kind === "cleanup" && entry.error === marker)
        .length,
      1,
    );
    assert.equal(done.successful, false);
  } finally {
    bodyRelease.resolve();
    drainRelease.resolve();
    await app.stop();
  }
});

test("ignored own task open holds run until actual acquisition and original handle cleanup", async () => {
  const entered = deferred();
  const opened = deferred<OpenOutcome<object>>();
  const handle = {};
  let closed: object | undefined;
  const app = createApplication({ providers: [] });
  await app.start();
  const run = app.run((scope) => {
    void scope.acquire({
      name: "ignored pending",
      open() {
        entered.resolve();
        return opened.promise;
      },
      close(value) {
        closed = value;
      },
    });
    return 7;
  });
  try {
    await bounded(entered.promise);
    await pending(run);
    assert.equal(
      closed,
      undefined,
      "ignored pending task open cannot publish run success or close early",
    );
    opened.resolve({ ok: true, value: handle });
    assert.equal(await bounded(run), 7);
    assert.equal(
      closed,
      handle,
      "ignored acquisition closes its original handle before root run resolves",
    );
  } finally {
    opened.resolve({ ok: false, error: "recovery", disposition: "not-acquired" });
    await app.stop();
  }
});
