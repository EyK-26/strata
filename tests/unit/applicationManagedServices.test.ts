import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  aliasService,
  resourceService,
  service,
  valueService,
} from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import {
  createApplication,
  type OpenOutcome,
  type ProviderScope,
} from "@getstrata/core/runtime/application";
import {
  bounded,
  deferred,
  pending,
  rejected,
  resource,
} from "../fixtures/applicationOwnershipSupport";

test("managed services initialize once before providers and share aliases and execution values", async () => {
  const events: string[] = [];
  const A = createServiceToken<string>("A");
  const B = createServiceToken<string>("B");
  const Alias = createServiceToken<string>("alias");
  const Empty = createServiceToken<undefined>("empty");
  const Caller = createServiceToken<{ close(): void }>("caller-owned");
  const app = createApplication({
    services: [
      resourceService(A, {
        lifetime: "application",
        dependencies: [],
        create: () => resource("A", events),
      }),
      resourceService(B, {
        lifetime: "application",
        dependencies: [A],
        create(a) {
          assert.equal(a, "A");
          return resource("B", events);
        },
      }),
      aliasService(Alias, B),
      resourceService(Empty, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          name: "empty",
          open: () => ({ ok: true, value: undefined }),
          close(value) {
            assert.equal(value, undefined);
            events.push("empty.close");
          },
        }),
      }),
      service(Caller, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          close() {
            events.push("caller.close");
          },
        }),
      }),
    ],
    providers: [
      {
        name: "provider",
        async setup(scope) {
          assert.equal(scope.resolve(Alias), "B");
          assert.equal(scope.resolve(Empty), undefined);
          assert.deepEqual(
            events,
            ["A.open", "B.open"],
            "managed eager initialization precedes providers",
          );
          await scope.acquire(resource("provider", events));
        },
      },
    ],
  });
  await app.start();
  await app.run((scope) => {
    assert.equal(scope.resolve(B), scope.resolve(Alias));
    assert.equal(scope.resolve(Empty), undefined);
    assert.equal(typeof scope.resolve(Caller).close, "function");
  });
  assert.equal((await bounded(app.stop())).successful, true);
  assert.equal(
    events.filter((event) => event === "B.open").length,
    1,
    "alias does not reacquire managed resource",
  );
  assert.deepEqual(
    events.filter((event) => event.endsWith(".close")),
    ["provider.close", "empty.close", "B.close", "A.close"],
    "managed dependency disposal follows provider disposal",
  );
});

test("final managed overrides and alias overrides determine acquisition and retention", async () => {
  const events: string[] = [];
  const A = createServiceToken<string>("A");
  const B = createServiceToken<string>("B");
  const First = createServiceToken<string>("first alias");
  const Second = createServiceToken<string>("second alias");
  const Dependent = createServiceToken<string>("dependent");
  const marker = Symbol("close");
  const app = createApplication({
    providers: [],
    services: [
      resourceService(A, {
        lifetime: "application",
        dependencies: [],
        create() {
          assert.fail("replaced descriptor must never construct");
        },
      }),
      valueService(B, "old B"),
      aliasService(First, A),
      aliasService(Second, A),
      resourceService(Dependent, {
        lifetime: "application",
        dependencies: [First],
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
        lifetime: "application",
        dependencies: [],
        create: () => resource("B", events),
      }),
      aliasService(First, B),
    ],
  });
  await app.start();
  await app.run((scope) => {
    assert.equal(scope.resolve(First), "B");
    assert.equal(
      scope.resolve(Second),
      "replacement A",
      "alias override changes only its final node",
    );
  });
  const done = await bounded(app.stop());
  assert.equal(done.successful, false);
  assert.equal(
    events.includes("B.close"),
    false,
    "final alias override retains its managed target",
  );
  assert.deepEqual([...done.snapshot.retainedResources].sort(), ["B", "dependent"]);
  assert.ok(done.snapshot.errors.some((entry) => entry.error === marker));
});

test("managed graphs reject final captive alias paths and unsupported lifetimes before effects", () => {
  let effects = 0;
  const A = createServiceToken<string>("A");
  const Alias = createServiceToken<string>("alias");
  const Pure = createServiceToken<string>("pure");
  const Managed = createServiceToken<string>("managed");
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
          valueService(A, "original"),
          aliasService(Alias, A),
          service(Pure, {
            lifetime: "application",
            dependencies: [Alias],
            create(value) {
              effects++;
              return value;
            },
          }),
          resourceService(Managed, {
            lifetime: "application",
            dependencies: [Pure],
            create() {
              effects++;
              return resource("managed", []);
            },
          }),
        ],
        overrides: [
          service(A, {
            lifetime: "execution",
            dependencies: [],
            create() {
              effects++;
              return "execution";
            },
          }),
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        Reflect.get(error, "code"),
        "SERVICE_GRAPH_CAPTIVE_DEPENDENCY",
        "final managed captive diagnostic",
      );
      return true;
    },
  );
  assert.throws(
    () =>
      resourceService(A, {
        lifetime: "execution" as never,
        dependencies: [],
        create() {
          effects++;
          return resource("A", []);
        },
      }),
    /application lifetime only/,
  );
  assert.equal(effects, 0, "managed graph failures happen before every effect");
});

for (const mode of ["unknown-open", "failed-close"] as const) {
  test(`managed ${mode} retains backing through pure factories and aliases while independent resources close`, async () => {
    const events: string[] = [];
    const marker = Symbol(mode);
    const A = createServiceToken<string>("A");
    const Pure = createServiceToken<string>("pure");
    const Alias = createServiceToken<string>("alias");
    const B = createServiceToken<string>("B");
    const C = createServiceToken<string>("C");
    const app = createApplication({
      providers: [],
      services: [
        resourceService(A, {
          lifetime: "application",
          dependencies: [],
          create: () => resource("A", events),
        }),
        service(Pure, { lifetime: "application", dependencies: [A], create: (a) => a }),
        aliasService(Alias, Pure),
        resourceService(C, {
          lifetime: "application",
          dependencies: [],
          create: () => resource("C", events),
        }),
        resourceService(B, {
          lifetime: "application",
          dependencies: [Alias],
          create: () =>
            resource(
              "B",
              events,
              mode === "unknown-open"
                ? {
                    open: () => ({ ok: false, error: marker, disposition: "unknown" }),
                  }
                : {
                    close() {
                      events.push("B.close");
                      throw marker;
                    },
                  },
            ),
        }),
      ],
    });
    if (mode === "unknown-open") assert.equal(await rejected(app.start()), marker);
    else {
      await app.start();
      await bounded(app.stop());
    }
    const done = await bounded(app.completion);
    assert.equal(done.successful, false);
    if (mode === "unknown-open")
      assert.equal(
        events.includes("A.flush"),
        false,
        "unknown managed dependent blocks backing flush",
      );
    assert.equal(
      events.includes("A.close"),
      false,
      "transitive managed backing never closes under retained dependent",
    );
    assert.equal(
      events.filter((event) => event === "C.close").length,
      1,
      "independent managed sibling closes",
    );
    assert.deepEqual([...done.snapshot.retainedResources].sort(), ["A", "B"]);
    assert.ok(done.snapshot.errors.some((entry) => entry.error === marker));
  });
}

for (const owner of ["provider", "transport"] as const) {
  test(`${owner} failures retain all managed services without declared requires`, async () => {
    const events: string[] = [];
    const A = createServiceToken<string>("A");
    const Unresolved = createServiceToken<string>("unresolved");
    const marker = Symbol(owner);
    const definition = {
      name: owner,
      async setup(scope: ProviderScope) {
        assert.equal(scope.resolve(A), "A");
        await scope.acquire(
          resource("dependent", events, {
            close() {
              events.push("dependent.close");
              throw marker;
            },
          }),
        );
      },
    };
    const app = createApplication({
      providers: owner === "provider" ? [definition] : [],
      transports: owner === "transport" ? [definition] : [],
      services: [
        resourceService(A, {
          lifetime: "application",
          dependencies: [],
          create: () => resource("A", events),
        }),
        resourceService(Unresolved, {
          lifetime: "application",
          dependencies: [],
          create: () => resource("unresolved", events),
        }),
      ],
    });
    await app.start();
    const done = await bounded(app.stop());
    assert.equal(done.successful, false);
    assert.equal(events.includes("A.close"), false, "implicit managed backing remains live");
    assert.equal(
      events.includes("unresolved.close"),
      false,
      "implicit all-managed retention includes unresolved services",
    );
    assert.deepEqual([...done.snapshot.retainedResources].sort(), ["A", "dependent", "unresolved"]);
  });
}

test("managed identity survives equal token provider and resource labels across two applications", async () => {
  const A = createServiceToken<{ app: number; id: string }>("same");
  const B = createServiceToken<{ app: number; id: string }>("same");
  const opened: Array<{ app: number; id: string }> = [];
  const closed: Array<{ app: number; id: string }> = [];
  const marker = Symbol("only first A fails close");
  const make = (appNumber: number) =>
    createApplication({
      services: [A, B].map((token, index) =>
        resourceService(token, {
          lifetime: "application",
          dependencies: [],
          create: () => ({
            name: "same",
            open() {
              const value = { app: appNumber, id: index === 0 ? "A" : "B" };
              opened.push(value);
              return { ok: true, value };
            },
            close(value) {
              closed.push(value);
              if (value.app === 1 && value.id === "A") throw marker;
            },
          }),
        }),
      ),
      providers: [
        {
          name: "same",
          async setup(scope) {
            assert.notEqual(
              scope.resolve(A),
              scope.resolve(B),
              "equal token labels have distinct managed values",
            );
            await scope.acquire({
              name: "same",
              open() {
                const value = { app: appNumber, id: "provider" };
                opened.push(value);
                return { ok: true, value };
              },
              close(value) {
                closed.push(value);
              },
            });
          },
        },
      ],
    });
  const first = make(1);
  const second = make(2);
  await Promise.all([first.start(), second.start()]);
  const firstStop = await bounded(first.stop());
  assert.equal(firstStop.successful, false);
  assert.equal(
    closed.filter((value) => value.app === 2).length,
    0,
    "one application cannot close the other's equal labels",
  );
  assert.deepEqual(
    closed.map((value) => value.id),
    ["provider", "B", "A"],
    "equal resource labels preserve every original handle",
  );
  assert.deepEqual(
    firstStop.snapshot.retainedResources,
    ["same"],
    "only failed managed identity remains retained",
  );
  assert.equal((await bounded(second.stop())).successful, true);
  assert.equal(opened.length, 6);
  assert.equal(closed.length, 6, "no private reservation is closed twice");
  assert.equal(
    new Set(closed).size,
    6,
    "every private reservation closes its original handle exactly once",
  );
  assert.deepEqual(
    new Set(closed),
    new Set(opened),
    "private identities preserve the exact acquired handles",
  );
});

test("managed pending cancellation retains actual open and converges on a late producer", async () => {
  const events: string[] = [];
  const A = createServiceToken<string>("A");
  const B = createServiceToken<string>("B");
  const opening = deferred();
  const late = deferred<OpenOutcome<string>>();
  const stopEntered = deferred();
  const stopRelease = deferred();
  let providers = 0;
  const app = createApplication({
    shutdownTimeoutMs: 15,
    services: [
      resourceService(A, {
        lifetime: "application",
        dependencies: [],
        create: () =>
          resource("A", events, {
            async stop() {
              events.push("A.stop");
              stopEntered.resolve();
              await stopRelease.promise;
            },
          }),
      }),
      resourceService(B, {
        lifetime: "application",
        dependencies: [A],
        create: () =>
          resource("B", events, {
            open() {
              events.push("B.open");
              opening.resolve();
              return late.promise;
            },
          }),
      }),
    ],
    providers: [
      {
        name: "provider",
        setup() {
          providers++;
        },
      },
    ],
  });
  const startup = app.start();
  try {
    await bounded(opening.promise);
    const stop = app.stop();
    await bounded(stopEntered.promise);
    const timed = await bounded(stop);
    assert.equal(timed.timedOut, true);
    assert.deepEqual(
      timed.snapshot.pendingAcquisitions,
      ["B"],
      "admitted managed open remains pending after bounded stop",
    );
    await pending(app.completion);
    assert.equal(
      events.some((event) => event.endsWith(".close")),
      false,
      "pending managed work prevents backing close",
    );
    late.resolve({ ok: true, value: "B" });
    await rejected(startup);
    await pending(app.completion);
    stopRelease.resolve();
    const done = await bounded(app.completion);
    assert.equal(providers, 0, "late managed success cannot enter providers or publish ready");
    assert.equal(done.snapshot.boot, "cancelled");
    assert.equal(done.snapshot.cleanup, "clean");
    assert.deepEqual(
      events,
      [
        "A.open",
        "B.open",
        "A.stop",
        "B.stop",
        "B.drain",
        "A.drain",
        "B.flush",
        "A.flush",
        "B.close",
        "A.close",
      ],
      "late managed producer receives every phase exactly once before backing closes",
    );
    assert.deepEqual(
      timed.snapshot.pendingAcquisitions,
      ["B"],
      "delivered stop snapshot is immutable after actual open settles",
    );
  } finally {
    late.resolve({ ok: false, error: Symbol("recovery"), disposition: "not-acquired" });
    stopRelease.resolve();
    await app.stop();
  }
});

for (const mode of ["not-acquired", "cleaned", "unknown", "raw", "malformed"] as const) {
  test(`managed ${mode} acquisition keeps disposal distinct from cleanup diagnostics`, async () => {
    const events: string[] = [];
    const marker = mode === "raw" ? undefined : Symbol(mode);
    const cleanup = Symbol("acquisition cleanup error");
    const A = createServiceToken<string>("backing");
    const B = createServiceToken<string>("dependent");
    let getterReads = 0;
    const malformed = Object.defineProperty({}, "ok", {
      get() {
        getterReads++;
        throw new Error("must not inspect");
      },
    });
    const app = createApplication({
      providers: [],
      services: [
        resourceService(A, {
          lifetime: "application",
          dependencies: [],
          create: () => resource("backing", events),
        }),
        resourceService(B, {
          lifetime: "application",
          dependencies: [A],
          create: () => ({
            name: "dependent",
            open(): OpenOutcome<string> {
              if (mode === "raw") throw marker;
              if (mode === "malformed") return malformed as OpenOutcome<string>;
              return {
                ok: false,
                error: marker,
                disposition: mode,
                ...(mode === "cleaned" ? { cleanupErrors: [cleanup] } : {}),
              };
            },
            close() {
              assert.fail("failed acquisition never supplies an acquired handle");
            },
          }),
        }),
      ],
    });
    const failure = await rejected(app.start());
    const done = await bounded(app.completion);
    const discharged = mode === "not-acquired" || mode === "cleaned";
    assert.equal(
      events.includes("backing.close"),
      discharged,
      "managed outcome disposition controls backing release",
    );
    assert.deepEqual(
      [...done.snapshot.retainedResources].sort(),
      discharged ? [] : ["backing", "dependent"],
      "managed retained obligations follow actual outcome",
    );
    assert.equal(getterReads, 0, "malformed managed outcome accessors are never evaluated");
    if (mode === "cleaned") {
      assert.ok(failure instanceof AggregateError);
      assert.equal(failure.cause, marker);
      assert.ok(
        done.snapshot.errors.some((entry) => entry.kind === "cleanup" && entry.error === cleanup),
      );
    } else if (mode !== "malformed")
      assert.equal(failure, marker, "opaque managed acquisition failure identity survives");
    assert.equal(
      done.snapshot.cleanup,
      mode === "not-acquired" ? "clean" : "failed",
      "discharged ownership does not hide failed acquisition cleanup",
    );
  });
}

for (const mode of ["throws", "invalid-spec", "cancels", "reflection-cancels"] as const) {
  test(`managed descriptor ${mode} before admission never opens or invents unknown ownership`, async () => {
    const events: string[] = [];
    const A = createServiceToken<string>("backing");
    const B = createServiceToken<string>("dependent");
    const marker = Symbol(mode);
    let opens = 0;
    let app: ReturnType<typeof createApplication>;
    app = createApplication({
      providers: [],
      services: [
        resourceService(A, {
          lifetime: "application",
          dependencies: [],
          create: () => resource("backing", events),
        }),
        resourceService(B, {
          lifetime: "application",
          dependencies: [A],
          create() {
            if (mode === "throws") throw marker;
            if (mode === "cancels") void app.stop();
            const spec = {
              name: "dependent",
              open: () => {
                opens++;
                return { ok: true as const, value: "dependent" };
              },
              close() {},
            };
            if (mode === "invalid-spec")
              Object.defineProperty(spec, "open", {
                get() {
                  assert.fail("spec accessor must not execute");
                },
              });
            if (mode === "reflection-cancels")
              return new Proxy(spec, {
                getOwnPropertyDescriptor(target, key) {
                  if (key === "name") void app.stop();
                  return Reflect.getOwnPropertyDescriptor(target, key);
                },
              });
            return spec;
          },
        }),
      ],
    });
    const failure = await rejected(app.start());
    if (mode === "throws") assert.equal(failure, marker);
    const done = await bounded(app.completion);
    assert.equal(opens, 0, "descriptor cancellation or invalidity prevents managed open admission");
    assert.deepEqual(done.snapshot.pendingAcquisitions, []);
    assert.deepEqual(
      done.snapshot.retainedResources,
      [],
      "pre-admission failure creates no unknown ownership",
    );
    assert.equal(
      events.filter((event) => event === "backing.close").length,
      1,
      "pre-admission failure safely disposes backing",
    );
    assert.equal(done.snapshot.cleanup, "clean");
  });
}

test("managed payload rejection captures original handle before Promise assimilation", async () => {
  const events: string[] = [];
  const A = createServiceToken<string>("backing");
  const B = createServiceToken<object>("hostile payload");
  let thenReads = 0;
  // biome-ignore lint/suspicious/noThenProperty: Adversarial payload must be rejected before native then access.
  const handle = Object.defineProperty({}, "then", {
    get() {
      thenReads++;
      throw new Error("native assimilation must not execute");
    },
  });
  let closed: object | undefined;
  let providers = 0;
  const app = createApplication({
    services: [
      resourceService(A, {
        lifetime: "application",
        dependencies: [],
        create: () => resource("backing", events),
      }),
      resourceService(B, {
        lifetime: "application",
        dependencies: [A],
        create: () => ({
          name: "hostile",
          open: () => ({ ok: true, value: handle }),
          close(value) {
            closed = value;
            events.push("hostile.close");
          },
        }),
      }),
    ],
    providers: [
      {
        name: "provider",
        setup() {
          providers++;
        },
      },
    ],
  });
  const failure = await rejected(app.start());
  const done = await bounded(app.completion);
  assert.equal(
    thenReads,
    0,
    "managed payload validator runs before Promise assimilation reads then",
  );
  assert.ok(failure instanceof TypeError);
  assert.equal(closed, handle, "publication rejection closes the original acquired handle");
  assert.equal(providers, 0, "invalid managed payload is never published to providers");
  assert.deepEqual(
    events.filter((event) => event.endsWith(".close")),
    ["hostile.close", "backing.close"],
  );
  assert.deepEqual(
    done.snapshot.retainedResources,
    [],
    "known acquired payload rejection is disposed rather than marked unknown",
  );
  assert.equal(done.snapshot.cleanup, "clean");
});

for (const failedClose of [false, true]) {
  test(`managed failed flush with ${failedClose ? "failed" : "successful"} close reports cleanup separately from disposal`, async () => {
    const events: string[] = [];
    const flush = Symbol("flush");
    const close = Symbol("close");
    const A = createServiceToken<string>("backing");
    const B = createServiceToken<string>("dependent");
    const app = createApplication({
      providers: [],
      services: [
        resourceService(A, {
          lifetime: "application",
          dependencies: [],
          create: () => resource("backing", events),
        }),
        resourceService(B, {
          lifetime: "application",
          dependencies: [A],
          create: () =>
            resource("dependent", events, {
              flush() {
                events.push("dependent.flush");
                throw flush;
              },
              close() {
                events.push("dependent.close");
                if (failedClose) throw close;
              },
            }),
        }),
      ],
    });
    await app.start();
    const done = await bounded(app.stop());
    assert.equal(
      done.successful,
      false,
      "failed flush remains unsuccessful after actual successful disposal",
    );
    assert.equal(done.snapshot.cleanup, "failed");
    assert.equal(
      events.filter((event) => event === "dependent.close").length,
      1,
      "failed flush still attempts actual close",
    );
    assert.equal(
      events.includes("backing.close"),
      !failedClose,
      "actual close acknowledgement determines backing disposal after failed flush",
    );
    assert.deepEqual(
      [...done.snapshot.retainedResources].sort(),
      failedClose ? ["backing", "dependent"] : [],
    );
    assert.ok(
      done.snapshot.errors.some((entry) => entry.phase === "flush" && entry.error === flush),
    );
    assert.equal(
      done.snapshot.errors.some((entry) => entry.error === close),
      failedClose,
    );
  });
}

test("managed helper authenticity and malformed graphs reject before descriptor or provider effects", () => {
  const A = createServiceToken<string>("A");
  const Missing = createServiceToken<string>("missing");
  let effects = 0;
  const create = () => {
    effects++;
    return resource("A", []);
  };
  for (const options of [
    { lifetime: "application", dependencies: {}, create },
    { lifetime: "application", dependencies: [], create: null },
    { lifetime: "application", dependencies: [{}], create },
  ])
    assert.throws(() => resourceService(A, options as never), TypeError);
  const declaration = resourceService(A, { lifetime: "application", dependencies: [], create });
  assert.equal(Object.isFrozen(declaration), true);
  assert.equal(Object.isFrozen(declaration.dependencies), true);
  for (const [declarations, code] of [
    [[{ ...declaration }], "SERVICE_GRAPH_INVALID_DECLARATION"],
    [[{ ...declaration, lifetime: "execution" }], "SERVICE_GRAPH_INVALID_LIFETIME"],
    [
      [resourceService(A, { lifetime: "application", dependencies: [Missing], create })],
      "SERVICE_GRAPH_MISSING_DEPENDENCY",
    ],
    [
      [resourceService(A, { lifetime: "application", dependencies: [A], create })],
      "SERVICE_GRAPH_CYCLE",
    ],
  ] as const) {
    assert.throws(
      () =>
        createApplication({
          services: declarations as never,
          providers: [
            {
              name: "provider",
              setup() {
                effects++;
              },
            },
          ],
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          Reflect.get(error, "code"),
          code,
          "managed invalid final graph has a specific diagnostic",
        );
        return true;
      },
    );
  }
  assert.equal(effects, 0, "invalid managed declarations never run descriptor or provider effects");
});

test("managed payload reflection cancellation preserves captured handle without provider readiness", async () => {
  const Token = createServiceToken<object>("reflection payload");
  let app: ReturnType<typeof createApplication>;
  let closed: object | undefined;
  let providers = 0;
  const handle = new Proxy(
    {},
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === "then") void app.stop();
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  app = createApplication({
    services: [
      resourceService(Token, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          name: "reflection",
          open: () => ({ ok: true, value: handle }),
          close(value) {
            closed = value;
          },
        }),
      }),
    ],
    providers: [
      {
        name: "provider",
        setup() {
          providers++;
        },
      },
    ],
  });
  await rejected(app.start());
  const done = await bounded(app.completion);
  assert.equal(
    closed,
    handle,
    "reflection cancellation disposes the original known acquired handle",
  );
  assert.equal(providers, 0, "reflection cancellation prevents managed publication to providers");
  assert.equal(done.snapshot.boot, "cancelled");
  assert.deepEqual(done.snapshot.retainedResources, []);
  assert.equal(done.snapshot.cleanup, "clean");
});
