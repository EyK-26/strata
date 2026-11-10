import { test } from "bun:test";
import assert from "node:assert/strict";
import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
import {
  aliasService,
  resourceService,
  service,
  valueService,
} from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import {
  type CleanupContext,
  createApplication,
  type ExecutionContext,
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
    assert.equal(
      error,
      expected[0],
      "one execution resource failure remains the exact opaque occurrence",
    );
    return;
  }
  assert.ok(error instanceof AggregateError);
  assert.equal(Object.isFrozen(error), true);
  assert.equal(Object.isFrozen(error.errors), true);
  assert.equal(error.cause, expected[0]);
  assert.equal(
    error.errors.length,
    expected.length,
    "execution failure composition preserves exact occurrence count",
  );
  expected.forEach((value, index) => {
    assert.equal(
      error.errors[index],
      value,
      "execution failure composition preserves private order and opaque identity",
    );
  });
}

test("execution resources initialize once before callbacks and survive actual descendants with selection-wide phases", async () => {
  const events: string[] = [];
  const A = createServiceToken<{ executionId: string }>("A");
  const Alias = createServiceToken<{ executionId: string }>("alias");
  const Pure = createServiceToken<{ executionId: string }>("pure");
  const B = createServiceToken<string>("B");
  const App = createServiceToken<string>("app");
  const entered = deferred();
  const release = deferred();
  let creates = 0;
  let closed: object | undefined;
  const app = createApplication({
    providers: [],
    services: [
      resourceService(App, {
        lifetime: "application",
        dependencies: [],
        create: () => resource("app", events),
      }),
      resourceService(A, {
        lifetime: "execution",
        dependencies: [CORE_EXECUTION_CONTEXT_TOKEN, App],
        create(context, backing) {
          creates++;
          assert.equal(backing, "app");
          const handle = { executionId: context.executionId };
          return {
            name: "A",
            open() {
              events.push("A.open");
              return { ok: true, value: handle };
            },
            stop() {
              events.push("A.stop");
            },
            drain() {
              events.push("A.drain");
            },
            flush() {
              events.push("A.flush");
            },
            close(value, cleanup) {
              assert.equal(cleanup.reason, "execution-complete");
              closed = value;
              events.push("A.close");
            },
          };
        },
      }),
      aliasService(Alias, A),
      service(Pure, { lifetime: "execution", dependencies: [Alias], create: (value) => value }),
      resourceService(B, {
        lifetime: "execution",
        dependencies: [Pure],
        create: () => resource("B", events),
      }),
    ],
  });
  await app.start();
  assert.equal(creates, 0, "application startup never constructs execution resource descriptors");
  assert.deepEqual(events, ["app.open"]);
  let handle!: object;
  const run = app.run((root) => {
    handle = root.resolve(A);
    assert.equal(root.resolve(Pure), handle);
    assert.equal(root.resolve(B), "B");
    void root.spawn(async (child) => {
      assert.equal(child.resolve(Alias), handle);
      await child.acquire(resource("task", events));
      return child.spawn(async (grandchild) => {
        entered.resolve();
        await release.promise;
        assert.equal(
          grandchild.resolve(Pure),
          handle,
          "live descendant shares execution binding after root body returns",
        );
        assert.equal(
          events.includes("A.close"),
          false,
          "execution binding remains live beneath actual descendant",
        );
        return 9;
      });
    });
    return 7;
  });
  try {
    await bounded(entered.promise);
    await pending(run);
    assert.equal(creates, 1, "aliases and actual children share one execution acquisition");
    release.resolve();
    assert.equal(await bounded(run), 7);
    assert.equal(closed, handle, "execution binding closes original handle before run resolves");
    assert.deepEqual(
      events.slice(3),
      [
        "task.open",
        "task.stop",
        "task.drain",
        "task.flush",
        "task.close",
        "B.stop",
        "A.stop",
        "B.drain",
        "A.drain",
        "B.flush",
        "A.flush",
        "B.close",
        "A.close",
      ],
      "execution binding selection completes every phase before advancing to the next phase",
    );
    assert.equal(events.includes("app.close"), false);
  } finally {
    release.resolve();
    await app.stop();
  }
});

test("overlapping execution bindings use fresh owners across runs and applications with equal labels", async () => {
  const Token = createServiceToken<{ applicationId: string; executionId: string }>("same");
  const opened: object[] = [];
  const closed: object[] = [];
  const make = () =>
    createApplication({
      providers: [{ name: "same", setup() {} }],
      services: [
        resourceService(Token, {
          lifetime: "execution",
          dependencies: [CORE_EXECUTION_CONTEXT_TOKEN],
          create(context) {
            const handle = {
              applicationId: context.applicationId,
              executionId: context.executionId,
            };
            return {
              name: "same",
              open() {
                opened.push(handle);
                return { ok: true, value: handle };
              },
              close(value) {
                closed.push(value);
              },
            };
          },
        }),
      ],
    });
  const a = make();
  const b = make();
  const entered = deferred();
  const release = deferred();
  await Promise.all([a.start(), b.start()]);
  let firstHandle!: object;
  const first = a.run(async (scope) => {
    firstHandle = scope.resolve(Token);
    entered.resolve();
    await release.promise;
    return firstHandle;
  });
  try {
    await bounded(entered.promise);
    const outcomes = await Promise.all(
      [a, b].map((app) =>
        app
          .run((scope) => scope.resolve(Token))
          .then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
      ),
    );
    for (const outcome of outcomes) {
      assert.equal(
        outcome.ok,
        true,
        "another execution never reuses a live binding owner or reservation",
      );
      if (outcome.ok) {
        assert.notEqual(outcome.value, firstHandle);
        assert.equal(closed.includes(outcome.value), true);
      }
    }
    assert.equal(
      closed.includes(firstHandle),
      false,
      "finishing another run cannot close the first run's binding",
    );
    release.resolve();
    assert.equal(await bounded(first), firstHandle);
    assert.equal(opened.length, 3);
    assert.equal(closed.length, 3);
    assert.deepEqual(
      new Set(closed),
      new Set(opened),
      "each run disposes exactly its original execution binding handle",
    );
  } finally {
    release.resolve();
    await Promise.all([a.stop(), b.stop()]);
  }
});

test("execution final overrides and aliases retain managed backing through pure factories", async () => {
  const events: string[] = [];
  const marker = Symbol("dependent close");
  const A = createServiceToken<string>("A");
  const B = createServiceToken<string>("B");
  const First = createServiceToken<string>("first");
  const Second = createServiceToken<string>("second");
  const Pure = createServiceToken<string>("pure");
  const Dependent = createServiceToken<string>("dependent");
  const Safe = createServiceToken<string>("safe");
  const app = createApplication({
    providers: [],
    services: [
      resourceService(A, {
        lifetime: "execution",
        dependencies: [],
        create() {
          assert.fail("replaced execution descriptor must not construct");
        },
      }),
      valueService(B, "old B"),
      aliasService(First, A),
      aliasService(Second, A),
      service(Pure, { lifetime: "execution", dependencies: [First], create: (value) => value }),
      resourceService(Safe, {
        lifetime: "execution",
        dependencies: [],
        create: () => resource("safe", events),
      }),
      resourceService(Dependent, {
        lifetime: "execution",
        dependencies: [Pure],
        create(value) {
          assert.equal(value, "B");
          return resource("dependent", events, {
            close() {
              events.push("dependent.close");
              throw marker;
            },
          });
        },
      }),
    ],
    overrides: [
      valueService(A, "replacement A"),
      resourceService(B, {
        lifetime: "execution",
        dependencies: [],
        create: () => resource("B", events),
      }),
      aliasService(First, B),
    ],
  });
  await app.start();
  occurrences(
    await rejected(
      app.run((scope) => {
        assert.equal(scope.resolve(First), "B");
        assert.equal(scope.resolve(Second), "replacement A");
      }),
    ),
    [marker],
  );
  assert.equal(
    events.includes("B.close"),
    false,
    "final execution alias and pure dependency retain backing after failed close",
  );
  assert.equal(
    events.filter((event) => event === "safe.close").length,
    1,
    "independent execution binding still closes after binding cleanup failure",
  );
  const done = await app.stop();
  assert.equal(done.successful, false);
  assert.deepEqual([...done.snapshot.retainedResources].sort(), ["B", "dependent"]);
});

for (const mode of ["descriptor", "pure", "not-acquired", "raw", "cleaned"] as const) {
  test(`execution initialization ${mode} failure finalizes partial ownership once without a callback body`, async () => {
    const events: string[] = [];
    const marker =
      mode === "not-acquired"
        ? undefined
        : new AggregateError([Symbol("caller entry")], "opaque initializer error");
    const internal = Symbol("internal cleanup");
    let bodies = 0;
    let laterCreates = 0;
    const A = createServiceToken<string>("A");
    const C = createServiceToken<string>("C");
    const Failed = createServiceToken<string>("failed");
    const Later = createServiceToken<string>("later");
    const dependencies = [A] as const;
    const failed =
      mode === "pure"
        ? service(Failed, {
            lifetime: "execution",
            dependencies,
            create() {
              throw marker;
            },
          })
        : resourceService(Failed, {
            lifetime: "execution",
            dependencies,
            create(): ResourceSpec<string> {
              if (mode === "descriptor") throw marker;
              return {
                name: "failed",
                open() {
                  if (mode === "raw") throw marker;
                  return {
                    ok: false,
                    error: marker,
                    disposition: mode === "cleaned" ? "cleaned" : "not-acquired",
                    ...(mode === "cleaned" ? { cleanupErrors: [internal] } : {}),
                  };
                },
                close() {
                  assert.fail("failed initializer supplied no handle");
                },
              };
            },
          });
    const app = createApplication({
      providers: [],
      services: [
        resourceService(A, {
          lifetime: "execution",
          dependencies: [],
          create: () => resource("A", events),
        }),
        resourceService(C, {
          lifetime: "execution",
          dependencies: [],
          create: () => resource("C", events),
        }),
        failed,
        resourceService(Later, {
          lifetime: "execution",
          dependencies: [],
          create() {
            laterCreates++;
            return resource("later", events);
          },
        }),
      ],
    });
    await app.start();
    occurrences(
      await rejected(
        app.run(() => {
          bodies++;
        }),
      ),
      mode === "cleaned" ? [marker, internal] : [marker],
    );
    assert.equal(
      bodies,
      0,
      "failed execution initialization never invents a callback body occurrence",
    );
    assert.equal(
      laterCreates,
      0,
      "execution initialization is sequential and stops at first rejected initializer",
    );
    assert.equal(
      events.filter((event) => event === "C.close").length,
      1,
      "partial execution initialization cleans independent binding before rejecting run",
    );
    assert.equal(
      events.includes("A.close"),
      mode !== "raw",
      "unknown initializer ownership keeps its execution backing",
    );
    if (marker instanceof AggregateError) assert.equal(Object.isFrozen(marker), false);
    assert.equal(app.state.phase, "ready");
    const done = await app.stop();
    assert.equal(done.successful, mode !== "raw" && mode !== "cleaned");
  });
}

test("post-acquisition container validation reports one initializer failure and disposes its known handle", async () => {
  const Token = createServiceToken<object>("second validation");
  const marker = Symbol("container validation");
  let reflections = 0;
  let bodies = 0;
  let closed: object | undefined;
  const handle = new Proxy(
    {},
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === "then" && ++reflections === 2) throw marker;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  const app = createApplication({
    providers: [],
    services: [
      resourceService(Token, {
        lifetime: "execution",
        dependencies: [],
        create: () => ({
          name: "known",
          open: () => ({ ok: true, value: handle }),
          close(value) {
            closed = value;
          },
        }),
      }),
    ],
  });
  await app.start();
  assert.equal(
    await rejected(
      app.run(() => {
        bodies++;
      }),
    ),
    marker,
    "post-success initialization failure is not suppressed by successful acquisition",
  );
  assert.equal(bodies, 0);
  assert.equal(
    closed,
    handle,
    "second container validation still closes original acquired binding handle",
  );
  assert.equal((await app.stop()).successful, true);
});

test("pending execution binding remains owned through bounded stop and late producer cleanup", async () => {
  const events: string[] = [];
  const Token = createServiceToken<object>("execution");
  const Backing = createServiceToken<string>("app");
  const entered = deferred();
  const outcome = deferred<OpenOutcome<object>>();
  const stopped = deferred();
  const stopRelease = deferred();
  const handle = {};
  let closed: object | undefined;
  let bodies = 0;
  let stops = 0;
  const app = createApplication({
    shutdownTimeoutMs: 20,
    providers: [],
    services: [
      resourceService(Backing, {
        lifetime: "application",
        dependencies: [],
        create: () => resource("app", events),
      }),
      resourceService(Token, {
        lifetime: "execution",
        dependencies: [Backing],
        create: () => ({
          name: "execution",
          open() {
            entered.resolve();
            return outcome.promise;
          },
          async stop() {
            stops++;
            stopped.resolve();
            await stopRelease.promise;
          },
          close(value) {
            closed = value;
            events.push("execution.close");
          },
        }),
      }),
    ],
  });
  await app.start();
  const run = app.run(() => {
    bodies++;
  });
  try {
    await bounded(entered.promise);
    const timed = await bounded(app.stop());
    assert.equal(timed.timedOut, true);
    assert.deepEqual(timed.snapshot.pendingAcquisitions, ["execution"]);
    await pending(run);
    await pending(app.completion);
    assert.equal(
      events.includes("app.close"),
      false,
      "pending execution initializer keeps actual application backing alive",
    );
    outcome.resolve({ ok: true, value: handle });
    await bounded(stopped.promise);
    await pending(run);
    stopRelease.resolve();
    const failure = await rejected(run);
    assert.ok(failure instanceof Error);
    assert.equal(
      Reflect.get(failure, "code"),
      "APPLICATION_START_CANCELLED",
      "late admitted execution failure contributes once without phantom initializer duplicate",
    );
    const done = await bounded(app.completion);
    assert.equal(bodies, 0);
    assert.equal(stops, 1);
    assert.equal(closed, handle);
    assert.deepEqual(
      events.filter((event) => event.endsWith(".close")),
      ["execution.close", "app.close"],
    );
    assert.equal(done.snapshot.cleanup, "clean");
  } finally {
    outcome.resolve({ ok: false, error: "recovery", disposition: "not-acquired" });
    stopRelease.resolve();
    await app.stop();
  }
});

test("retained child task keeps all its execution bindings while a later run cleans independent owners", async () => {
  type Handle = { executionId: string; name: string };
  const A = createServiceToken<Handle>("same");
  const B = createServiceToken<Handle>("same");
  const App = createServiceToken<string>("app");
  const opened: Handle[] = [];
  const closed: Handle[] = [];
  const events: string[] = [];
  const marker = Symbol("child close");
  let taskCloses = 0;
  const app = createApplication({
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
    services: [
      resourceService(App, {
        lifetime: "application",
        dependencies: [],
        create: () => resource("app", events),
      }),
      ...[A, B].map((token, index) =>
        resourceService(token, {
          lifetime: "execution",
          dependencies: [CORE_EXECUTION_CONTEXT_TOKEN],
          create(context) {
            const value = { executionId: context.executionId, name: String(index) };
            return {
              name: "same",
              open() {
                opened.push(value);
                return { ok: true, value };
              },
              close(handle) {
                closed.push(handle);
              },
            };
          },
        }),
      ),
    ],
  });
  await app.start();
  let firstExecution!: string;
  occurrences(
    await rejected(
      app.run((root) => {
        firstExecution = root.resolve(A).executionId;
        void root.spawn(async (child) => {
          await child.acquire(
            resource("task", events, {
              close() {
                taskCloses++;
                throw marker;
              },
            }),
          );
        });
      }),
    ),
    [marker],
  );
  assert.equal(
    closed.filter((value) => value.executionId === firstExecution).length,
    0,
    "retained task keeps all run bindings including an unresolved binding",
  );
  await app.run((scope) => {
    assert.notEqual(scope.resolve(A).executionId, firstExecution);
  });
  assert.equal(
    closed.length,
    2,
    "later execution cleanup remains independent of retained run binding owners",
  );
  assert.equal(
    closed.some((value) => value.executionId === firstExecution),
    false,
  );
  assert.equal(opened.length, 4);
  assert.deepEqual(
    new Set(closed),
    new Set(opened.filter((value) => value.executionId !== firstExecution)),
    "later run disposes each distinct original binding without closing a retained run handle",
  );
  const done = await app.stop();
  assert.equal(done.successful, false);
  assert.equal(taskCloses, 1);
  for (const name of ["app", "provider", "transport"])
    assert.equal(
      events.includes(`${name}.close`),
      false,
      "retained execution bindings preserve every static backing group",
    );
});

test("execution binding cleanup composes raw callback occurrences without reinserting public summaries", async () => {
  const Token = createServiceToken<string>("binding");
  const opaque = new AggregateError(["caller nested"], "caller error");
  const flush = Symbol("binding flush");
  const app = createApplication({
    providers: [],
    services: [
      resourceService(Token, {
        lifetime: "execution",
        dependencies: [],
        create: () =>
          resource("binding", [], {
            flush() {
              throw flush;
            },
          }),
      }),
    ],
  });
  await app.start();
  const failure = await rejected(
    app.run(async (root) => {
      await root
        .acquire({
          name: "task",
          open: () => ({ ok: false, error: undefined, disposition: "not-acquired" }),
          close() {},
        })
        .catch(() => {});
      void root.spawn(() => {
        throw opaque;
      });
      throw undefined;
    }),
  );
  occurrences(failure, [undefined, undefined, opaque, flush]);
  assert.equal(Object.isFrozen(opaque), false);
  assert.deepEqual(opaque.errors, ["caller nested"]);
  const done = await app.stop();
  assert.equal(done.successful, false);
  assert.deepEqual(done.snapshot.retainedResources, []);
});

test("execution context remains connected until binding cleanup actually settles", async () => {
  const Token = createServiceToken<ExecutionContext>("context binding");
  const external = new AbortController();
  const marker = Symbol("external cancel during close");
  const entered = deferred();
  const release = deferred();
  let execution!: ExecutionContext;
  let cleanup!: CleanupContext;
  const app = createApplication({
    providers: [],
    services: [
      resourceService(Token, {
        lifetime: "execution",
        dependencies: [CORE_EXECUTION_CONTEXT_TOKEN],
        create(context) {
          return {
            name: "context",
            open: () => ({ ok: true, value: context }),
            async close(value, cleanupContext) {
              execution = value;
              cleanup = cleanupContext;
              entered.resolve();
              await release.promise;
            },
          };
        },
      }),
    ],
  });
  await app.start();
  const run = app.run({ kind: "command", signal: external.signal }, () => 7);
  try {
    await bounded(entered.promise);
    await pending(run);
    external.abort(marker);
    assert.equal(
      execution.signal.aborted,
      true,
      "execution context is not disposed before actual binding cleanup",
    );
    assert.equal(execution.signal.reason, marker);
    assert.notEqual(cleanup.signal, execution.signal);
    assert.equal(cleanup.signal.aborted, false);
    assert.equal(cleanup.reason, "execution-complete");
    assert.equal(Object.isFrozen(cleanup), true);
    release.resolve();
    assert.equal(await bounded(run), 7);
  } finally {
    release.resolve();
    await app.stop();
  }
});

test("final execution resource override rejects application capture through pure alias paths before effects", () => {
  const Scoped = createServiceToken<string>("scoped");
  const Alias = createServiceToken<string>("alias");
  const Pure = createServiceToken<string>("pure");
  const App = createServiceToken<string>("application");
  let effects = 0;
  assert.throws(
    () =>
      createApplication({
        providers: [
          {
            name: "provider",
            setup() {
              effects++;
            },
          },
        ],
        services: [
          valueService(Scoped, "original application value"),
          aliasService(Alias, Scoped),
          service(Pure, {
            lifetime: "application",
            dependencies: [Alias],
            create(value) {
              effects++;
              return value;
            },
          }),
          resourceService(App, {
            lifetime: "application",
            dependencies: [Pure],
            create() {
              effects++;
              return resource("app", []);
            },
          }),
        ],
        overrides: [
          resourceService(Scoped, {
            lifetime: "execution",
            dependencies: [],
            create() {
              effects++;
              return resource("scoped", []);
            },
          }),
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        Reflect.get(error, "code"),
        "SERVICE_GRAPH_CAPTIVE_DEPENDENCY",
        "final managed execution override preserves exact captive diagnostic",
      );
      return true;
    },
  );
  assert.equal(
    effects,
    0,
    "invalid final execution resource graph rejects before all initializer and provider effects",
  );
});

test("execution spec reflection checks clock-expired deadline before admitting a binding open", async () => {
  const Earlier = createServiceToken<string>("earlier");
  const Target = createServiceToken<string>("deadline binding");
  const events: string[] = [];
  let opens = 0;
  let bodies = 0;
  const originalNow = Date.now;
  let clock = originalNow();
  const deadline = clock + 1000;
  const app = createApplication({
    providers: [],
    services: [
      resourceService(Earlier, {
        lifetime: "execution",
        dependencies: [],
        create: () => resource("earlier", events),
      }),
      resourceService(Target, {
        lifetime: "execution",
        dependencies: [Earlier],
        create: () =>
          new Proxy<ResourceSpec<string>>(
            {
              name: "deadline",
              open() {
                opens++;
                return { ok: true, value: "deadline" };
              },
              close() {
                events.push("deadline.close");
              },
            },
            {
              getOwnPropertyDescriptor(target, key) {
                if (key === "name") clock = deadline + 1;
                return Reflect.getOwnPropertyDescriptor(target, key);
              },
            },
          ),
      }),
    ],
  });
  await app.start();
  Date.now = () => clock;
  try {
    const failure = await rejected(
      app.run({ kind: "command", deadlineAtMs: deadline }, () => {
        bodies++;
      }),
    );
    assert.ok(failure instanceof Error);
    assert.equal(Reflect.get(failure, "code"), "EXECUTION_DEADLINE");
    assert.equal(
      opens,
      0,
      "execution spec reflection deadline is checked before journal open admission",
    );
    assert.equal(bodies, 0, "clock-expired execution initializer never enters callback body");
    assert.equal(
      events.filter((event) => event === "earlier.close").length,
      1,
      "clock-expired initialization disposes already acquired binding before rejection",
    );
    assert.equal(events.includes("deadline.close"), false);
  } finally {
    Date.now = originalNow;
    assert.equal((await app.stop()).successful, true);
  }
});
