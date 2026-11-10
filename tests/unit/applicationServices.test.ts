import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import {
  aliasService,
  type ServiceDeclaration,
  service,
  valueService,
} from "@getstrata/core/contracts/services";
import {
  assertServiceToken,
  createServiceToken,
  isServiceToken,
  serviceTokenKey,
  serviceTokenName,
} from "@getstrata/core/contracts/token";
import {
  type CommandScope,
  createApplication,
  type ProviderScope,
} from "@getstrata/core/runtime/application";
import { bounded, deferred, pending, rejected } from "../fixtures/applicationOwnershipSupport";

test("tokens with identical labels remain distinct and payloads keep their own mutability", async () => {
  const first = createServiceToken<{ count: number }>("same");
  const second = createServiceToken<{ count: number }>("same");
  const payload = { count: 1 };
  assert.ok(Object.isFrozen(first));
  assert.notEqual(first, second);
  assert.notEqual(serviceTokenKey(first), serviceTokenKey(second));
  assert.equal(serviceTokenName(first), "same");
  const app = createApplication({
    providers: [],
    services: [valueService(first, payload), valueService(second, { count: 2 })],
  });
  await app.start();
  try {
    await app.run((scope) => {
      assert.equal(scope.resolve(first), payload);
      assert.equal(scope.resolve(second).count, 2);
      scope.resolve(first).count = 3;
      assert.throws(() => scope.resolve("same" as never));
      assert.throws(() => scope.resolve(createServiceToken<number>("same")));
    });
    assert.equal(payload.count, 3);
    assert.equal(Object.isFrozen(payload), false);
  } finally {
    await bounded(app.stop());
  }
});

test("token validation fails closed for malformed values and proxy traps", () => {
  const proxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw 0;
      },
    },
  );
  const prototypeTrap = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw 0;
      },
    },
  );
  for (const value of [undefined, null, 0, "legacy", {}, () => {}, proxy, prototypeTrap]) {
    assert.equal(isServiceToken(value), false);
    assert.throws(() => assertServiceToken(value));
    assert.throws(() => serviceTokenKey(value as never));
    assert.throws(() => serviceTokenName(value as never));
  }
  for (const name of [undefined, null, 1, "", " "])
    assert.throws(() => createServiceToken(name as never));
});

test("container registry introspection recognizes transient and alias definitions without instantiating them", () => {
  const Value = createServiceToken<number>("value");
  const Alias = createServiceToken<number>("alias");
  const Missing = createServiceToken<number>("missing");
  const engine = new ServiceContainer();
  let calls = 0;
  assert.equal(engine.has(Value), false);
  engine.bind(Value, () => ++calls);
  engine.alias(Alias, Value);
  assert.equal(engine.has(Value), true);
  assert.equal(engine.has(Alias), true);
  assert.equal(engine.has(Missing), false);
  assert.equal(calls, 0);
  assert.equal(engine.make(Alias), 1);
  assert.equal(engine.make(Value), 2);
  engine.set(Value, 9);
  assert.equal(engine.resolve(Alias), 9);
});

test("the single container shares initialization work, resolves aliases and seals mutation", async () => {
  const Token = createServiceToken<{ value: number }>("value");
  const Alias = createServiceToken<{ value: number }>("alias");
  const New = createServiceToken<number>("new");
  const engine = new ServiceContainer();
  const gate = deferred<{ value: number }>();
  const entered = deferred();
  const cancellation = new AbortController();
  let calls = 0;
  const first = engine.initialize(
    Token,
    () => {
      calls++;
      entered.resolve();
      return gate.promise;
    },
    cancellation.signal,
  );
  const second = engine.initialize(
    Token,
    () => {
      calls++;
      return { value: 99 };
    },
    cancellation.signal,
  );
  assert.equal(first, second);
  try {
    await bounded(entered.promise);
    assert.throws(() => engine.resolve(Token));
    gate.resolve({ value: 1 });
    const value = await bounded(first);
    engine.alias(Alias, Token);
    assert.equal(engine.make(Alias), value);
    assert.equal(engine.resolve(Token), value);
    assert.equal(calls, 1);
    engine.seal();
    assert.equal(
      engine.initialize(Token, () => ({ value: 2 }), cancellation.signal),
      first,
    );
    for (const mutate of [
      () => engine.set(Token, { value: 3 }),
      () => engine.singleton(Token, () => ({ value: 3 })),
      () => engine.bind(Token, () => ({ value: 3 })),
      () => engine.instance(Token, { value: 3 }),
      () => engine.alias(Alias, Token),
    ])
      assert.throws(mutate);
    await rejected(
      Promise.resolve().then(() =>
        engine.initialize(
          New,
          () => {
            calls++;
            return 2;
          },
          cancellation.signal,
        ),
      ),
    );
    assert.equal(calls, 1);
  } finally {
    gate.resolve({ value: 1 });
  }
});

test("container initialization caches failed attempts and rejects late cancelled values without cross-container leakage", async () => {
  const Token = createServiceToken<number>("same");
  const first = new ServiceContainer();
  const second = new ServiceContainer();
  const signal = new AbortController();
  let attempts = 0;
  const failed = first.initialize(
    Token,
    () => {
      attempts++;
      throw 0;
    },
    signal.signal,
  );
  assert.equal(await rejected(failed), 0);
  assert.equal(
    first.initialize(
      Token,
      () => {
        attempts++;
        return 9;
      },
      signal.signal,
    ),
    failed,
  );
  assert.equal(await rejected(failed), 0);
  assert.equal(attempts, 1);
  assert.equal(await second.initialize(Token, () => 2, signal.signal), 2);
  first.set(Token, 3);
  assert.equal(first.resolve(Token), 3);
  assert.equal(second.resolve(Token), 2);
  const Late = createServiceToken<number>("late");
  const gate = deferred<number>();
  const entered = deferred();
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: true });
  const result = first.initialize(
    Late,
    () => {
      entered.resolve();
      return gate.promise;
    },
    controller.signal,
  );
  const failure = rejected(result);
  await bounded(entered.promise);
  controller.abort(reason);
  assert.throws(() => first.resolve(Late));
  gate.resolve(7);
  assert.equal(await failure, reason);
  assert.throws(() => first.resolve(Late));
  let forbidden = 0;
  const before = first.initialize(
    createServiceToken<number>("already aborted"),
    () => {
      forbidden++;
      return 1;
    },
    controller.signal,
  );
  assert.equal(await rejected(before), reason);
  assert.equal(forbidden, 0);
});

test("malformed declaration options and corrupted descriptor copies reject before application effects", () => {
  const Count = createServiceToken<number>("number");
  const Text = createServiceToken<string>("text");
  let effects = 0;
  const factory = () => {
    effects++;
    return 1;
  };
  for (const options of [
    null,
    {},
    { lifetime: "other", dependencies: [], create: factory },
    { lifetime: "application", dependencies: null, create: factory },
    { lifetime: "application", dependencies: ["legacy"], create: factory },
    { lifetime: "application", dependencies: [], create: 0 },
  ]) {
    assert.throws(() =>
      createApplication({ providers: [], services: [service(Count, options as never)] }),
    );
  }
  const value = valueService(Count, 1);
  const originalFactory = service(Count, {
    lifetime: "application",
    dependencies: [],
    create: factory,
  });
  const alias = aliasService(Count, createServiceToken<number>("target"));
  const copies = [
    { ...value, value: "wrong" },
    Object.freeze({ ...value, value: "wrong" }),
    { ...originalFactory, create: () => "wrong" },
    { ...alias, target: Text },
    new Proxy(value, {}),
  ];
  for (const raw of [
    { kind: "factory", token: Count, lifetime: "application", dependencies: null, create: factory },
    { kind: "factory", token: Count, lifetime: "application", dependencies: [], create: 0 },
  ])
    assert.throws(() => createApplication({ providers: [], services: [raw as never] }));
  for (const copy of copies)
    assert.throws(
      () =>
        createApplication({
          services: [copy],
          providers: [
            {
              name: "unstarted",
              setup() {
                effects++;
              },
            },
          ],
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(Reflect.get(error, "code"), "SERVICE_GRAPH_INVALID_DECLARATION");
        return true;
      },
    );
  assert.equal(effects, 0);
});

test("noncallable data named then remains an ordinary service payload", async () => {
  const Value = createServiceToken<{ then: string }>("value");
  const Factory = createServiceToken<{ then: string }>("factory");
  // biome-ignore lint/suspicious/noThenProperty: This is a deliberately noncallable data property.
  const payload = { then: "label" };
  const app = createApplication({
    providers: [],
    services: [
      valueService(Value, payload),
      service(Factory, { lifetime: "application", dependencies: [], create: async () => payload }),
    ],
  });
  await app.start();
  try {
    await app.run((scope) => {
      assert.equal(scope.resolve(Value), payload);
      assert.equal(scope.resolve(Factory), payload);
    });
  } finally {
    await bounded(app.stop());
  }
});

test("cyclic reflected service prototypes reject rather than looping during payload validation", () => {
  let cyclic: object;
  cyclic = new Proxy(
    {},
    {
      getPrototypeOf() {
        return cyclic;
      },
    },
  );
  assert.throws(() => valueService(createServiceToken<unknown>("cyclic"), cyclic), TypeError);
});

test("callback descriptor and prototype trap results preserve identity and expire their resolver", async () => {
  const Value = createServiceToken<number>("value");
  const app = createApplication({ providers: [], services: [valueService(Value, 1)] });
  const descriptor = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw 0;
      },
    },
  );
  const prototype = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw 0;
      },
    },
  );
  await app.start();
  try {
    for (const payload of [descriptor, prototype]) {
      let saved: CommandScope | undefined;
      assert.equal(
        await app.run((scope) => {
          saved = scope;
          assert.equal(scope.resolve(Value), 1);
          return payload;
        }),
        payload,
      );
      assert.throws(
        () => saved?.resolve(Value),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(Reflect.get(error, "code"), "APPLICATION_SCOPE_EXPIRED");
          return true;
        },
      );
    }
  } finally {
    await bounded(app.stop());
  }
});

test("a cyclic callback result prototype preserves identity without blocking the test host", async () => {
  // Isolate the cyclic-prototype probe so a regression cannot block the test host's event loop.
  const source = `
import assert from 'node:assert/strict';
import { createApplication } from '@getstrata/core/runtime/application';
import { createServiceToken } from '@getstrata/core/contracts/token';
import { valueService } from '@getstrata/core/contracts/services';
const Token = createServiceToken('value');
const app = createApplication({providers:[],services:[valueService(Token,1)]});
let cyclic; cyclic = new Proxy({}, {getPrototypeOf(){return cyclic;}});
await app.start();
try {
  for (const payload of [cyclic]) {
    let saved;
    assert.equal(await app.run(scope=>{saved=scope;assert.equal(scope.resolve(Token),1);return payload;}),payload);
    assert.throws(()=>saved.resolve(Token),error=>error.code==='APPLICATION_SCOPE_EXPIRED');
  }
  console.log(JSON.stringify({proxyKinds:1}));
} finally {await app.stop();}
`;
  const child = Bun.spawn([process.execPath, "--eval", source], {
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
    killSignal: "SIGKILL",
  });
  const [output, errors, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exit, 0, `Proxy-result child failed: ${output}\n${errors}`);
  assert.equal(JSON.parse(output.trim()).proxyKinds, 1);
}, 7000);

test("eager async factories receive only ordered declared values before providers and aliases initialize once", async () => {
  const A = createServiceToken<number>("A");
  const B = createServiceToken<{ value: number }>("B");
  const Alias = createServiceToken<{ value: number }>("Alias");
  const gate = deferred();
  const entered = deferred();
  const events: string[] = [];
  let calls = 0;
  const app = createApplication({
    services: [
      aliasService(Alias, B),
      service(B, {
        lifetime: "application",
        dependencies: [A],
        create: async (...values) => {
          calls++;
          assert.deepEqual(values, [7]);
          events.push("factory");
          entered.resolve();
          await gate.promise;
          return { value: values[0] };
        },
      }),
      valueService(A, 7),
    ],
    providers: [
      {
        name: "provider",
        setup(scope) {
          events.push("provider");
          assert.equal(scope.resolve(B), scope.resolve(Alias));
          assert.equal(scope.resolve(B).value, 7);
          assert.equal("container" in scope, false);
        },
      },
    ],
  });
  assert.deepEqual(events, []);
  const start = app.start();
  assert.equal(app.start(), start);
  try {
    await bounded(entered.promise);
    await pending(start);
    assert.deepEqual(events, ["factory"]);
    gate.resolve();
    await bounded(start);
    assert.deepEqual(events, ["factory", "provider"]);
    await app.run((scope) => assert.equal(scope.resolve(Alias), scope.resolve(B)));
    assert.equal(calls, 1);
  } finally {
    gate.resolve();
    await bounded(app.stop());
  }
});

test("target overrides update every alias while an alias override replaces only its own node", async () => {
  const Target = createServiceToken<number>("target");
  const Alias = createServiceToken<number>("alias");
  const Outer = createServiceToken<number>("outer");
  const Result = createServiceToken<number>("result");
  const definitions = [
    valueService(Target, 1),
    aliasService(Alias, Target),
    aliasService(Outer, Alias),
    service(Result, {
      lifetime: "application",
      dependencies: [Outer],
      create: (value) => value * 10,
    }),
  ];
  for (const mode of ["target", "alias"] as const) {
    const app = createApplication({
      providers: [],
      services: definitions,
      overrides: [valueService(mode === "target" ? Target : Alias, 9)],
    });
    await app.start();
    try {
      await app.run((scope) => {
        assert.equal(scope.resolve(Target), mode === "target" ? 9 : 1);
        assert.equal(scope.resolve(Alias), 9);
        assert.equal(scope.resolve(Outer), 9);
        assert.equal(scope.resolve(Result), 90);
      });
    } finally {
      await bounded(app.stop());
    }
  }
});

test("invalid final dependency and override graphs reject before any factory or provider effect", () => {
  const A = createServiceToken<number>("A");
  const B = createServiceToken<number>("B");
  const Missing = createServiceToken<number>("missing");
  let effects = 0;
  const factory = (dependencies: readonly (typeof A)[]) =>
    service(A, {
      lifetime: "application",
      dependencies,
      create() {
        effects++;
        return 1;
      },
    });
  const invalid: Array<{ services: ServiceDeclaration[]; overrides?: ServiceDeclaration[] }> = [
    { services: [valueService(A, 1), valueService(A, 2)] },
    { services: [factory([Missing])] },
    { services: [aliasService(A, Missing)] },
    { services: [aliasService(A, B), aliasService(B, A)] },
    {
      services: [
        factory([B]),
        service(B, { lifetime: "application", dependencies: [A], create: (a) => a }),
      ],
    },
    { services: [aliasService(B, A), factory([B])] },
    { services: [valueService(A, 1)], overrides: [valueService(Missing, 2)] },
    { services: [valueService(A, 1)], overrides: [valueService(A, 2), valueService(A, 3)] },
    { services: [valueService(A, 1), aliasService(B, A)], overrides: [aliasService(A, B)] },
    { services: [valueService(A, 1)], overrides: [factory([Missing])] },
  ];
  for (const definition of invalid)
    assert.throws(() =>
      createApplication({
        ...definition,
        providers: [
          {
            name: "not-entered",
            setup() {
              effects++;
            },
          },
        ],
      }),
    );
  assert.equal(effects, 0);
});

test("transitive and aliased captive dependencies remain rejected with execution capability enabled", () => {
  const Scoped = createServiceToken<number>("execution");
  const Alias = createServiceToken<number>("alias");
  const Outer = createServiceToken<number>("outer");
  let effects = 0;
  const execution = service(Scoped, {
    lifetime: "execution",
    dependencies: [],
    create() {
      effects++;
      return 1;
    },
  });
  const checkCode = (definitions: ServiceDeclaration[], code: string) => {
    assert.throws(
      () => createApplication({ providers: [], services: definitions }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(Reflect.get(error, "code"), code);
        return true;
      },
    );
  };
  // Valid execution declarations are enabled; graph capture diagnostics stay specific.
  assert.doesNotThrow(() => createApplication({ providers: [], services: [execution] }));
  checkCode(
    [
      execution,
      aliasService(Alias, Scoped),
      service(Outer, {
        lifetime: "application",
        dependencies: [Alias],
        create: (value) => value,
      }),
    ],
    "SERVICE_GRAPH_CAPTIVE_DEPENDENCY",
  );
  checkCode(
    [
      {
        kind: "resource",
        token: Outer,
        open() {
          effects++;
        },
      } as never,
    ],
    "SERVICE_GRAPH_INVALID_DECLARATION",
  );
  assert.equal(effects, 0);
});

test("composition is copied before startup and constructor declarations cannot become a mutation backdoor", async () => {
  const A = createServiceToken<number>("A");
  const B = createServiceToken<number>("B");
  const Missing = createServiceToken<number>("missing");
  const dependencies: [typeof A] = [A];
  const services = [
    valueService(A, 1),
    service(B, { lifetime: "application", dependencies, create: (value) => value }),
  ];
  const overrides = [valueService(A, 2)];
  const app = createApplication({ providers: [], services, overrides });
  dependencies[0] = Missing;
  services.push(valueService(A, 99));
  overrides.push(valueService(A, 88));
  await app.start();
  try {
    assert.equal(await app.run((scope) => scope.resolve(B)), 2);
  } finally {
    await bounded(app.stop());
  }
});

test("value declarations reject detectable thenables without executing their getters", () => {
  let reads = 0;
  // biome-ignore lint/suspicious/noThenProperty: Deliberate rejection probe for accessor thenables.
  const accessor = Object.defineProperty({}, "then", {
    get() {
      reads++;
      throw new Error("then getter invoked");
    },
  });
  // biome-ignore lint/suspicious/noThenProperty: Deliberate own callable-then payload.
  const ownThenable = { then() {} };
  // biome-ignore lint/suspicious/noThenProperty: Deliberate inherited callable-then payload.
  const inheritedThenable = Object.create({ then() {} });
  for (const value of [Promise.resolve(1), ownThenable, inheritedThenable, accessor]) {
    const Token = createServiceToken<unknown>("not-a-promise-service");
    assert.throws(() =>
      createApplication({ providers: [], services: [valueService(Token, value)] }),
    );
  }
  assert.equal(reads, 0);
});

test("undefined service values are eagerly initialized and cached without truthiness checks", async () => {
  const Value = createServiceToken<undefined>("undefined");
  const Alias = createServiceToken<undefined>("alias");
  let calls = 0;
  const app = createApplication({
    providers: [],
    services: [
      service(Value, {
        lifetime: "application",
        dependencies: [],
        create() {
          calls++;
          return undefined;
        },
      }),
      aliasService(Alias, Value),
    ],
  });
  await app.start();
  try {
    for (let i = 0; i < 2; i++)
      await app.run((scope) => {
        assert.equal(scope.resolve(Value), undefined);
        assert.equal(scope.resolve(Alias), undefined);
      });
    assert.equal(calls, 1);
  } finally {
    await bounded(app.stop());
  }
});

test("failed value initialization preserves opaque primary identity without entering later providers", async () => {
  let inspected = 0;
  const hostile = new Error();
  for (const key of ["message", "name", "cause", "code", "toString"])
    Object.defineProperty(hostile, key, {
      get() {
        inspected++;
        throw new Error("factory error inspected");
      },
    });
  for (const marker of [0, hostile]) {
    const Value = createServiceToken<number>("failure");
    let downstream = 0;
    const app = createApplication({
      services: [
        service(Value, {
          lifetime: "application",
          dependencies: [],
          create() {
            throw marker;
          },
        }),
      ],
      providers: [
        {
          name: "unstarted",
          setup() {
            downstream++;
          },
        },
      ],
    });
    assert.equal(await rejected(app.start()), marker);
    const done = await bounded(app.completion);
    assert.equal(done.snapshot.boot, "failed");
    assert.ok(
      done.snapshot.errors.some((entry) => entry.kind === "startup" && entry.error === marker),
    );
    assert.equal(downstream, 0);
  }
  assert.equal(inspected, 0);
});

test("provider composition resolution expires when that provider returns, before the next provider", async () => {
  const A = createServiceToken<number>("A");
  let saved: ProviderScope | undefined;
  const escaped = deferred();
  const app = createApplication({
    services: [valueService(A, 1)],
    providers: [
      {
        name: "first",
        setup(scope) {
          saved = scope;
          assert.equal(scope.resolve(A), 1);
          queueMicrotask(() => {
            try {
              assert.throws(() => scope.resolve(A));
              escaped.resolve();
            } catch (error) {
              escaped.reject(error);
            }
          });
        },
      },
      {
        name: "second",
        setup(scope) {
          assert.ok(saved);
          assert.throws(() => saved?.resolve(A));
          assert.equal(scope.resolve(A), 1);
        },
      },
    ],
  });
  await app.start();
  try {
    await bounded(escaped.promise);
    assert.ok(saved);
    assert.throws(() => saved?.resolve(A));
  } finally {
    await bounded(app.stop());
  }
});

test("sync callback return closes the resolver before an escaped microtask or later caller can use it", async () => {
  const A = createServiceToken<number>("A");
  let saved: CommandScope | undefined;
  const escaped = deferred();
  const app = createApplication({ providers: [], services: [valueService(A, 1)] });
  await app.start();
  try {
    assert.equal(
      await app.run((scope) => {
        saved = scope;
        assert.equal(scope.resolve(A), 1);
        queueMicrotask(() => {
          try {
            assert.throws(() => scope.resolve(A));
            escaped.resolve();
          } catch (error) {
            escaped.reject(error);
          }
        });
        return 0;
      }),
      0,
    );
    await bounded(escaped.promise);
    assert.throws(() => saved?.resolve(A));
    assert.equal(await app.run((scope) => scope.resolve(A)), 1);
  } finally {
    await bounded(app.stop());
  }
});

test("two app callback leases stay active across await and never fall back to the other active app", async () => {
  const A = createServiceToken<number>("same");
  const one = createApplication({ providers: [], services: [valueService(A, 1)] });
  const two = createApplication({ providers: [], services: [valueService(A, 2)] });
  const gate = deferred();
  const entered = deferred();
  let old: CommandScope | undefined;
  await Promise.all([one.start(), two.start()]);
  const work = one.run(async (scope) => {
    old = scope;
    entered.resolve();
    await gate.promise;
    return scope.resolve(A);
  });
  try {
    await bounded(entered.promise);
    assert.equal(await two.run((scope) => scope.resolve(A)), 2);
    gate.resolve();
    assert.equal(await bounded(work), 1);
    await two.run((scope) => {
      assert.equal(scope.resolve(A), 2);
      assert.throws(() => old?.resolve(A));
    });
  } finally {
    gate.resolve();
    await Promise.all([bounded(one.stop()), bounded(two.stop())]);
  }
});

test("sync and async callback errors preserve falsy identity while expiring their resolver leases", async () => {
  const A = createServiceToken<number>("A");
  const app = createApplication({ providers: [], services: [valueService(A, 1)] });
  await app.start();
  try {
    for (const asyncCallback of [false, true]) {
      let saved: CommandScope | undefined;
      const failure = app.run((scope) => {
        saved = scope;
        if (asyncCallback) return Promise.reject(undefined);
        throw undefined;
      });
      assert.equal(await rejected(failure), undefined);
      assert.throws(() => saved?.resolve(A));
    }
    assert.equal(
      app.state.errors.some((entry) => entry.kind === "startup"),
      false,
    );
  } finally {
    await bounded(app.stop());
  }
});

test("callback thenable assimilation reads then once and retains its resolver until actual settlement", async () => {
  const A = createServiceToken<number>("A");
  const assimilated = deferred();
  const gate = deferred<number>();
  let reads = 0;
  let saved: CommandScope | undefined;
  // biome-ignore lint/suspicious/noThenProperty: Deliberate native assimilation/getter-count probe.
  const thenable = Object.defineProperty({}, "then", {
    get() {
      reads++;
      return (resolve: (value: number) => void, reject: (error: unknown) => void) => {
        assimilated.resolve();
        void gate.promise.then(resolve, reject);
      };
    },
  });
  const app = createApplication({ providers: [], services: [valueService(A, 1)] });
  await app.start();
  const result = app.run((scope) => {
    saved = scope;
    return thenable as unknown as Promise<number>;
  });
  try {
    await bounded(assimilated.promise);
    assert.equal(saved?.resolve(A), 1);
    assert.equal(reads, 1);
    gate.resolve(8);
    assert.equal(await bounded(result), 8);
    assert.equal(reads, 1);
    assert.throws(() => saved?.resolve(A));
  } finally {
    gate.resolve(8);
    await bounded(app.stop());
  }
});

test("accessor nonthenable callback results preserve identity and expire on observed completion", async () => {
  const A = createServiceToken<number>("A");
  let saved: CommandScope | undefined;
  let reads = 0;
  // biome-ignore lint/suspicious/noThenProperty: Deliberate accessor candidate that is not callable.
  const payload = Object.defineProperty({ value: 1 }, "then", {
    get() {
      reads++;
      return undefined;
    },
  });
  const app = createApplication({ providers: [], services: [valueService(A, 1)] });
  await app.start();
  try {
    assert.equal(
      await app.run((scope) => {
        saved = scope;
        return payload;
      }),
      payload,
    );
    assert.ok(reads >= 1);
    assert.throws(() => saved?.resolve(A));
    // biome-ignore lint/suspicious/noThenProperty: Deliberate failing then-capability read.
    const broken = Object.defineProperty({}, "then", {
      get() {
        throw 0;
      },
    });
    assert.equal(
      await rejected(
        app.run((scope) => {
          saved = scope;
          return broken;
        }),
      ),
      0,
    );
    assert.throws(() => saved?.resolve(A));
  } finally {
    await bounded(app.stop());
  }
});

for (const late of ["value", "undefined-failure"] as const) {
  test(`stop retains an in-flight pure factory through late ${late} without publishing readiness`, async () => {
    const A = createServiceToken<number>("A");
    const B = createServiceToken<number>("B");
    const entered = deferred();
    const gate = deferred<number>();
    let downstream = 0;
    const app = createApplication({
      shutdownTimeoutMs: 25,
      services: [
        service(A, {
          lifetime: "application",
          dependencies: [],
          create() {
            entered.resolve();
            return gate.promise;
          },
        }),
        service(B, {
          lifetime: "application",
          dependencies: [A],
          create() {
            downstream++;
            return 2;
          },
        }),
      ],
      providers: [
        {
          name: "unstarted",
          setup() {
            downstream++;
          },
        },
      ],
    });
    const startup = app.start();
    const startFailure = rejected(startup);
    try {
      await bounded(entered.promise);
      const stop = await bounded(app.stop());
      assert.equal(stop.timedOut, true);
      assert.equal(stop.snapshot.cleanup, "pending");
      await pending(app.completion);
      await rejected(app.run(() => assert.fail("Stopped app admitted a callback")));
      if (late === "value") gate.resolve(1);
      else gate.reject(undefined);
      await startFailure;
      const done = await bounded(app.completion);
      assert.notEqual(done.snapshot.phase, "ready");
      assert.equal(downstream, 0);
      if (late === "undefined-failure")
        assert.ok(
          done.snapshot.errors.some(
            (entry) => entry.kind === "startup" && entry.error === undefined,
          ),
        );
      assert.equal(stop.snapshot.cleanup, "pending");
    } finally {
      gate.resolve(1);
      await bounded(app.completion);
    }
  });
}
