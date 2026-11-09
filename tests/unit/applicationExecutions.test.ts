import { test } from "bun:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_EXECUTION_CONTEXT_TOKEN as Context } from "@getstrata/core/contracts/executionContext";
import { aliasService, service, valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import {
  type CommandScope,
  createApplication,
  type ExecutionContext,
  type ExecutionEnvelope,
} from "@getstrata/core/runtime/application";
import {
  bounded,
  deferred,
  pending,
  rejected,
  resource,
} from "../fixtures/applicationOwnershipSupport";

function code(error: unknown, expected: string) {
  assert.ok(error instanceof Error);
  assert.equal(Reflect.get(error, "code"), expected);
}

test("execution children require a sealed parent and inherit typed values without legacy fallback", () => {
  const Token = createServiceToken<object>("parent");
  const Alias = createServiceToken<object>("child alias");
  const parent = new ServiceContainer();
  const value = {};
  parent.set(Token, value);
  parent.set("legacy", 1);
  assert.throws(() => new ServiceContainer(parent));
  parent.seal();
  const child = new ServiceContainer(parent);
  assert.equal(child.has(Token), true);
  assert.equal(child.resolve(Token), value);
  assert.equal(child.has("legacy"), false);
  assert.throws(() => child.resolve("legacy"));
  child.alias(Alias, Token);
  assert.equal(child.resolve(Alias), value);
  child.set(Token, {});
  assert.notEqual(child.resolve(Token), value);
  assert.equal(parent.resolve(Token), value);
  assert.equal(parent.has(Alias), false);
  child.seal();
  assert.throws(() => child.set(Token, {}));
});

test("eager execution factories isolate two runs and two apps while aliases honor final overrides", async () => {
  const AppValue = createServiceToken<object>("application");
  const Scoped = createServiceToken<{ parent: object; context: ExecutionContext }>("execution");
  const Alias = createServiceToken<{ parent: object; context: ExecutionContext }>(
    "execution alias",
  );
  const ParentAlias = createServiceToken<object>("parent alias");
  let appCalls = 0;
  let runCalls = 0;
  const make = () =>
    createApplication({
      providers: [],
      services: [
        service(AppValue, {
          lifetime: "application",
          dependencies: [],
          create: () => ({ app: ++appCalls }),
        }),
        aliasService(ParentAlias, AppValue),
        service(Scoped, {
          lifetime: "execution",
          dependencies: [AppValue, Context],
          create: (parent, context) => ({ parent, context }),
        }),
        aliasService(Alias, Scoped),
      ],
      overrides: [
        service(Scoped, {
          lifetime: "execution",
          dependencies: [ParentAlias, Context],
          create: async (parent, context) => {
            runCalls++;
            return { parent, context };
          },
        }),
      ],
    });
  const one = make();
  const two = make();
  await Promise.all([one.start(), two.start()]);
  assert.equal(appCalls, 2);
  assert.equal(runCalls, 0, "start must not initialize execution services");
  const contexts: ExecutionContext[] = [];
  const values: object[] = [];
  try {
    for (const app of [one, one, two])
      await app.run((scope) => {
        assert.equal(
          runCalls,
          contexts.length + 1,
          "execution factories must finish eagerly before body",
        );
        const value = scope.resolve(Scoped);
        assert.equal(scope.resolve(Alias), value);
        assert.equal(value.parent, scope.resolve(AppValue));
        assert.equal(scope.resolve(ParentAlias), value.parent);
        assert.equal(value.context, scope.context);
        assert.equal(scope.resolve(Context), scope.context);
        assert.equal(scope.signal, scope.context.signal);
        assert.equal(scope.context.applicationId, app.id);
        assert.equal(scope.context.kind, "command");
        assert.equal(Object.isFrozen(scope.context), true);
        assert.equal(Object.isFrozen(scope.context.metadata), true);
        contexts.push(scope.context);
        values.push(value);
      });
    assert.equal(new Set(values).size, 3);
    assert.equal(new Set(contexts.map((context) => context.executionId)).size, 3);
    assert.equal(
      (values[0] as { parent: object }).parent,
      (values[1] as { parent: object }).parent,
    );
    assert.notEqual(
      (values[0] as { parent: object }).parent,
      (values[2] as { parent: object }).parent,
    );
  } finally {
    await Promise.all([one.stop(), two.stop()]);
  }
});

test("context is reserved by identity and application factories cannot capture transitive aliases", async () => {
  const Alias = createServiceToken<ExecutionContext>("context alias");
  const Outer = createServiceToken<ExecutionContext>("outer");
  const sameLabel = createServiceToken<number>("CORE_EXECUTION_CONTEXT_TOKEN");
  for (const definition of [
    { services: [valueService(Context, {} as ExecutionContext)] },
    { overrides: [valueService(Context, {} as ExecutionContext)] },
  ])
    assert.throws(
      () => createApplication({ providers: [], ...definition }),
      (error) => {
        code(error, "SERVICE_GRAPH_RESERVED_TOKEN");
        return true;
      },
    );
  assert.throws(
    () =>
      createApplication({
        providers: [],
        services: [
          aliasService(Alias, Context),
          service(Outer, {
            lifetime: "application",
            dependencies: [Alias],
            create: (context) => context,
          }),
        ],
      }),
    (error) => {
      code(error, "SERVICE_GRAPH_CAPTIVE_DEPENDENCY");
      return true;
    },
  );
  const app = createApplication({
    services: [aliasService(Alias, Context), valueService(sameLabel, 4)],
    providers: [
      {
        name: "provider",
        setup(scope) {
          assert.throws(() => scope.resolve(Context));
          assert.throws(() => scope.resolve(Alias));
        },
      },
    ],
  });
  await app.start();
  try {
    await app.run((scope) => {
      assert.equal(scope.resolve(Alias), scope.context);
      assert.equal(scope.resolve(sameLabel), 4);
    });
  } finally {
    await app.stop();
  }
});

test("envelope metadata is copied frozen and absent optional fields never inherit", async () => {
  const app = createApplication({ providers: [] });
  await app.start();
  const metadata = { nested: { value: 1 } };
  const claims = { subject: "user", roles: ["reader"] };
  const envelope = {
    kind: "job" as const,
    actor: { kind: "principal" as const, claims },
    tenant: { id: "one" },
    metadata,
    externalId: "caller",
  };
  try {
    const result = app.run(envelope, (scope) => scope.context);
    metadata.nested.value = 9;
    claims.roles.push("writer");
    const context = await result;
    assert.deepEqual(context.metadata, { nested: { value: 1 } });
    assert.deepEqual(context.actor, {
      kind: "principal",
      claims: { subject: "user", roles: ["reader"] },
    });
    assert.equal(Object.isFrozen(context.actor), true);
    assert.equal(Object.isFrozen(context.tenant), true);
    assert.equal(context.externalId, "caller");
    await app.run({ kind: "request", actor: undefined, tenant: undefined }, (scope) => {
      for (const key of ["actor", "tenant", "externalId", "deadlineAtMs"])
        assert.equal(Object.hasOwn(scope.context, key), false);
      assert.deepEqual(scope.context.metadata, {});
    });
  } finally {
    await app.stop();
  }
});

test("malformed envelopes and callbacks reject before effects without changing ready boot", async () => {
  let effects = 0;
  let getters = 0;
  const Token = createServiceToken<number>("effect");
  const app = createApplication({
    providers: [],
    services: [
      service(Token, { lifetime: "execution", dependencies: [], create: () => ++effects }),
    ],
  });
  await app.start();
  const accessor = Object.defineProperty({ kind: "command" }, "metadata", {
    enumerable: true,
    get() {
      getters++;
      throw 0;
    },
  });
  const hidden = Object.defineProperty({ kind: "command" }, "extra", { value: 1 });
  const symbol = { kind: "command", [Symbol("hidden")]: 1 };
  const bad = [
    null,
    [],
    {},
    { kind: "other" },
    { kind: "job" },
    { kind: "job", actor: undefined },
    { kind: "command", actor: { kind: "system", policy: "" } },
    { kind: "command", actor: { kind: "unknown" } },
    { kind: "command", actor: { kind: "principal", claims: {}, policy: "invalid" } },
    { kind: "command", actor: { kind: "system", policy: "worker", claims: {} } },
    { kind: "command", actor: { kind: "system", policy: "worker", extra: true } },
    { kind: "command", actor: { kind: "principal", claims: [] } },
    { kind: "command", extra: true },
    { kind: "command", externalId: "" },
    { kind: "command", metadata: null },
    { kind: "command", tenant: [] },
    { kind: "command", deadlineAtMs: -1 },
    { kind: "command", deadlineAtMs: 1.5 },
    { kind: "command", deadlineAtMs: Infinity },
    { kind: "command", signal: {} },
    { kind: "command", signal: new Proxy(new AbortController().signal, {}) },
    Object.create({ kind: "command" }),
    accessor,
    hidden,
    symbol,
  ];
  try {
    for (const envelope of bad) {
      const error = await rejected(
        app.run(envelope as ExecutionEnvelope, () => {
          effects++;
        }),
      );
      assert.ok(error instanceof TypeError || error instanceof RangeError);
    }
    assert.ok((await rejected(app.run(undefined as never))) instanceof TypeError);
    assert.ok((await rejected(app.run({ kind: "command" }, 0 as never))) instanceof TypeError);
    assert.equal(getters, 0);
    assert.equal(effects, 0, "invalid admission must invoke no factory or callback");
    assert.equal(app.state.boot, "ready");
    assert.equal(app.state.errors.length, 0);
  } finally {
    await app.stop();
  }
  code(await rejected(app.run(null as never, 0 as never)), "APPLICATION_NOT_READY");
});

test("normalization reentrancy rechecks ready admission before invoking factories", async () => {
  let effects = 0;
  const Token = createServiceToken<number>("effect");
  const app = createApplication({
    providers: [],
    services: [
      service(Token, { lifetime: "execution", dependencies: [], create: () => ++effects }),
    ],
  });
  await app.start();
  const envelope = new Proxy(
    { kind: "command" as const },
    {
      ownKeys(target) {
        void app.stop();
        return Reflect.ownKeys(target);
      },
    },
  );
  code(
    await rejected(
      app.run(envelope, () => {
        effects++;
      }),
    ),
    "APPLICATION_NOT_READY",
  );
  assert.equal(effects, 0);
  assert.equal((await app.completion).successful, true);
});

test("pre-abort wins expired deadline and cancellation between run and factory prevents admission", async () => {
  let effects = 0;
  const Token = createServiceToken<number>("effect");
  const app = createApplication({
    providers: [],
    services: [
      service(Token, { lifetime: "execution", dependencies: [], create: () => ++effects }),
    ],
  });
  await app.start();
  try {
    for (const reason of [0, false, null, { opaque: true }]) {
      const controller = new AbortController();
      controller.abort(reason);
      assert.equal(
        await rejected(
          app.run({ kind: "command", signal: controller.signal, deadlineAtMs: 0 }, () => {
            effects++;
          }),
        ),
        reason,
      );
    }
    const controller = new AbortController();
    const result = app.run({ kind: "command", signal: controller.signal }, () => {
      effects++;
    });
    controller.abort(0);
    assert.equal(await rejected(result), 0);
    assert.equal(effects, 0, "cancelled admission must skip every factory and body");
    let context: ExecutionContext | undefined;
    const deadline = await rejected(
      app.run({ kind: "command", deadlineAtMs: 0 }, (scope) => {
        context = scope.context;
      }),
    );
    code(deadline, "EXECUTION_DEADLINE");
    assert.equal(Reflect.get(deadline as object, "applicationId"), app.id);
    assert.equal(typeof Reflect.get(deadline as object, "executionId"), "string");
    assert.equal(context, undefined);
  } finally {
    await app.stop();
  }
});

for (const outcome of ["success", "failure"] as const)
  test(`cancelled initialization owns actual late ${outcome} and holds backing infrastructure`, async () => {
    const entered = deferred();
    const gate = deferred<number>();
    const drained = deferred();
    const events: string[] = [];
    const Token = createServiceToken<number>("pending execution");
    const Later = createServiceToken<number>("later execution");
    let later = 0;
    const app = createApplication({
      shutdownTimeoutMs: 20,
      services: [
        service(Token, {
          lifetime: "execution",
          dependencies: [],
          create: () => {
            entered.resolve();
            return gate.promise;
          },
        }),
        service(Later, { lifetime: "execution", dependencies: [Token], create: () => ++later }),
      ],
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
    const external = new AbortController();
    const result = app.run({ kind: "command", signal: external.signal }, () => {
      later++;
    });
    const failure = rejected(result);
    try {
      await bounded(entered.promise);
      external.abort(false);
      const stop = app.stop();
      await bounded(drained.promise);
      await pending(result);
      const observation = await bounded(stop);
      assert.equal(observation.timedOut, true);
      await pending(app.completion);
      assert.equal(
        events.includes("backing.close"),
        false,
        "pending execution initialization must hold backing infrastructure",
      );
      if (outcome === "success") gate.resolve(3);
      else gate.reject(0);
      assert.equal(
        await failure,
        outcome === "success" ? false : 0,
        "actual factory rejection keeps identity; late success uses first cancellation",
      );
      const done = await bounded(app.completion);
      assert.equal(done.successful, true);
      assert.equal(done.snapshot.boot, "ready");
      assert.equal(done.snapshot.errors.length, 0);
      assert.equal(later, 0, "cancelled initialization cannot admit later factory or callback");
      assert.ok(events.indexOf("backing.drain") < events.indexOf("backing.close"));
    } finally {
      gate.resolve(3);
      await bounded(app.completion);
    }
  });

for (const outcome of ["success", "failure"] as const)
  test(`admitted callback keeps actual ${outcome} and resolver until settlement after cancellation`, async () => {
    const Token = createServiceToken<number>("value");
    const gate = deferred<number>();
    const entered = deferred();
    const external = new AbortController();
    let saved: CommandScope | undefined;
    const app = createApplication({ providers: [], services: [valueService(Token, 7)] });
    await app.start();
    const result = app.run({ kind: "request", signal: external.signal }, async (scope) => {
      saved = scope;
      entered.resolve();
      await gate.promise;
      assert.equal(scope.resolve(Token), 7);
      if (outcome === "failure") throw 0;
      return 9;
    });
    try {
      await bounded(entered.promise);
      external.abort(false);
      assert.equal(saved?.signal.reason, false);
      assert.equal(saved?.resolve(Token), 7);
      await pending(result);
      gate.resolve(1);
      if (outcome === "success") assert.equal(await result, 9);
      else assert.equal(await rejected(result), 0);
      await app.run(() => {
        assert.throws(() => saved?.resolve(Token));
      });
      assert.equal(app.state.errors.length, 0);
    } finally {
      gate.resolve(1);
      await app.stop();
    }
  });

test("deadline cancellation waits for callback settlement and the first signal reason wins", async () => {
  const app = createApplication({ providers: [] });
  const gate = deferred();
  const cancelled = deferred();
  const external = new AbortController();
  let context: ExecutionContext | undefined;
  await app.start();
  const result = app.run(
    {
      kind: "job",
      actor: { kind: "system", policy: "test" },
      signal: external.signal,
      deadlineAtMs: Date.now() + 25,
    },
    async (scope) => {
      context = scope.context;
      scope.signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
      await gate.promise;
      return 4;
    },
  );
  try {
    await bounded(cancelled.promise);
    assert.ok(context);
    code(context.signal.reason, "EXECUTION_DEADLINE");
    const reason = context.signal.reason;
    external.abort(0);
    assert.equal(context.signal.reason, reason);
    await pending(result);
    gate.resolve();
    assert.equal(await result, 4);
  } finally {
    gate.resolve();
    await app.stop();
  }
});

test("native signal intrinsics ignore shadow getters and listener methods and detach on settlement", async () => {
  const external = new AbortController();
  let shadowReads = 0;
  for (const key of ["aborted", "reason", "addEventListener", "removeEventListener"])
    Object.defineProperty(external.signal, key, {
      configurable: true,
      get() {
        shadowReads++;
        throw new Error("shadow signal API invoked");
      },
    });
  const app = createApplication({ providers: [] });
  await app.start();
  let context: ExecutionContext | undefined;
  try {
    await app.run(
      { kind: "command", signal: external.signal, deadlineAtMs: Number.MAX_SAFE_INTEGER },
      (scope) => {
        context = scope.context;
        assert.equal(scope.signal.aborted, false);
      },
    );
    assert.equal(shadowReads, 0);
    assert.equal(
      getEventListeners(external.signal, "abort").length,
      0,
      "execution must detach external abort listener",
    );
    external.abort(0);
    assert.equal(
      context?.signal.aborted,
      false,
      "disposed subscription cannot mutate settled context",
    );
    await app.stop();
    assert.equal(
      context?.signal.aborted,
      false,
      "settled signal must detach from application cancellation",
    );
  } finally {
    await app.stop();
  }
});

test("execution deadlines clear owned timers on all settlements and omit absent deadlines", async () => {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const delays: number[] = [];
  const Token = createServiceToken<number>("factory");
  let fail = false;
  const app = createApplication({
    providers: [],
    services: [
      service(Token, {
        lifetime: "execution",
        dependencies: [],
        create() {
          if (fail) throw 0;
          return 1;
        },
      }),
    ],
  });
  await app.start();
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    delays.push(delay ?? 0);
    const timer = realSet(callback, delay, ...args);
    timers.add(timer);
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    timers.delete(timer);
    realClear(timer);
  }) as typeof clearTimeout;
  try {
    await app.run(() => 1);
    assert.equal(delays.length, 0, "execution without deadline must not allocate timers");
    await app.run({ kind: "command", deadlineAtMs: Number.MAX_SAFE_INTEGER }, () => 1);
    assert.ok(delays.length > 0);
    assert.ok(
      delays.every((delay) => delay > 0 && delay <= 2_147_483_647),
      "distant deadlines must use bounded timer chunks",
    );
    assert.equal(timers.size, 0, "successful execution must clear deadline timer");
    const external = new AbortController();
    assert.equal(
      await app
        .run(
          { kind: "command", signal: external.signal, deadlineAtMs: Date.now() + 100000 },
          () => {
            throw false;
          },
        )
        .then(
          () => "fulfilled",
          (error: unknown) => error,
        ),
      false,
    );
    assert.equal(timers.size, 0, "failed callback must clear deadline timer");
    assert.equal(getEventListeners(external.signal, "abort").length, 0);
    fail = true;
    assert.equal(
      await app
        .run({ kind: "command", signal: external.signal, deadlineAtMs: Date.now() + 100000 }, () =>
          assert.fail("failed init admitted body"),
        )
        .then(
          () => "fulfilled",
          (error: unknown) => error,
        ),
      0,
    );
    assert.equal(timers.size, 0, "failed initialization must clear deadline timer");
    assert.equal(
      getEventListeners(external.signal, "abort").length,
      0,
      "failed initialization must detach external listener",
    );
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
    for (const timer of timers) realClear(timer);
    await app.stop();
  }
});

test("deadline setup failure preserves opaque identity and detaches already registered listeners", async () => {
  const external = new AbortController();
  const realSet = globalThis.setTimeout;
  let effects = 0;
  let appSignal: AbortSignal | undefined;
  const Token = createServiceToken<number>("setup effect");
  const app = createApplication({
    providers: [
      {
        name: "capture",
        setup(scope) {
          appSignal = scope.signal;
        },
      },
    ],
    services: [
      service(Token, { lifetime: "execution", dependencies: [], create: () => ++effects }),
    ],
  });
  await app.start();
  const externalBefore = getEventListeners(external.signal, "abort").length;
  assert.ok(appSignal);
  const appBefore = getEventListeners(appSignal, "abort").length;
  try {
    globalThis.setTimeout = (() => {
      throw 0;
    }) as unknown as typeof setTimeout;
    const result = app.run(
      { kind: "command", signal: external.signal, deadlineAtMs: Date.now() + 100000 },
      () => {
        effects++;
      },
    );
    globalThis.setTimeout = realSet;
    assert.equal(await rejected(result), 0);
    assert.equal(effects, 0, "failed context setup cannot admit factories or body");
    assert.equal(
      getEventListeners(external.signal, "abort").length,
      externalBefore,
      "failed context setup must detach external subscription",
    );
    assert.equal(
      getEventListeners(appSignal, "abort").length,
      appBefore,
      "failed context setup must detach application subscription",
    );
    assert.equal(app.state.boot, "ready");
    assert.equal(app.state.errors.length, 0);
  } finally {
    globalThis.setTimeout = realSet;
    await app.stop();
  }
});

test("deadline setup reentrant stop rechecks admission while retaining whole attempt ownership", async () => {
  const realNow = Date.now;
  const deadline = realNow() + 100000;
  const external = new AbortController();
  let effects = 0;
  let clockReads = 0;
  const Token = createServiceToken<number>("setup effect");
  const app = createApplication({
    providers: [],
    services: [
      service(Token, { lifetime: "execution", dependencies: [], create: () => ++effects }),
    ],
  });
  await app.start();
  try {
    Date.now = () => {
      clockReads++;
      void app.stop();
      return realNow();
    };
    const result = app.run(
      { kind: "command", signal: external.signal, deadlineAtMs: deadline },
      () => {
        effects++;
      },
    );
    Date.now = realNow;
    code(await rejected(result), "APPLICATION_NOT_READY");
    assert.equal(clockReads, 1);
    assert.equal(effects, 0, "reentrant stop during context setup must prevent factories and body");
    assert.equal(getEventListeners(external.signal, "abort").length, 0);
    const done = await bounded(app.completion);
    assert.equal(done.successful, true);
    assert.equal(done.snapshot.boot, "ready");
    assert.equal(done.snapshot.errors.length, 0);
  } finally {
    Date.now = realNow;
    await app.stop();
  }
});

for (const scenario of ["factory-success", "factory-rejection", "empty-graph"] as const)
  test(`deadline admission refresh observes elapsed wall clock after ${scenario}`, async () => {
    const realNow = Date.now;
    let now = 1000;
    let laterEffects = 0;
    let factoryCalls = 0;
    const First = createServiceToken<number>("clock advancing factory");
    const Later = createServiceToken<number>("dependent factory");
    const services =
      scenario === "empty-graph"
        ? []
        : [
            service(First, {
              lifetime: "execution",
              dependencies: [],
              create() {
                factoryCalls++;
                now = 3000;
                if (scenario === "factory-rejection") throw 0;
                return 1;
              },
            }),
            service(Later, {
              lifetime: "execution",
              dependencies: [First],
              create() {
                laterEffects++;
                return 2;
              },
            }),
          ];
    const app = createApplication({ providers: [], services });
    await app.start();
    try {
      Date.now = () => now;
      const result = app.run({ kind: "command", deadlineAtMs: 2000 }, () => {
        laterEffects++;
      });
      if (scenario === "empty-graph") now = 3000;
      const error = await rejected(result);
      if (scenario === "factory-rejection")
        assert.equal(
          error,
          0,
          "actual factory rejection must retain opaque identity despite elapsed deadline",
        );
      else code(error, "EXECUTION_DEADLINE");
      assert.equal(factoryCalls, scenario === "empty-graph" ? 0 : 1);
      assert.equal(
        laterEffects,
        0,
        "elapsed deadline must prevent dependent factory and callback admission before timer dispatch",
      );
      assert.equal(app.state.errors.length, 0);
    } finally {
      Date.now = realNow;
      await app.stop();
    }
  });
