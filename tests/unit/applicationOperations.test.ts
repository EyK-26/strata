import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  CORE_EXECUTION_OPERATIONS_TOKEN,
  type ExecutionOperations,
} from "@getstrata/core/contracts/executionOperations";
import {
  aliasService,
  resourceService,
  service,
  valueService,
} from "@getstrata/core/contracts/services";
import { createServiceToken, serviceTokenName } from "@getstrata/core/contracts/token";
import { type CommandScope, createApplication } from "@getstrata/core/runtime/application";
import {
  bounded,
  deferred,
  pending,
  rejected,
  resource,
} from "../fixtures/applicationOwnershipSupport";

function expired(error: unknown) {
  assert.ok(error instanceof Error);
  assert.equal(
    Reflect.get(error, "code"),
    "APPLICATION_SCOPE_EXPIRED",
    "operation authority rejects exact absent stale or mismatched lease",
  );
}
function attempt(work: () => unknown): { ok: true } | { ok: false; error: unknown } {
  try {
    work();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
function turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("operations token is canonical reserved execution authority with final captive and alias checks", async () => {
  const Alias = createServiceToken<ExecutionOperations>("operations alias");
  const App = createServiceToken<ExecutionOperations>("application capture");
  const fake: ExecutionOperations = { assertActive() {}, operation: async (work) => work() };
  const SameLabel = createServiceToken<ExecutionOperations>(
    serviceTokenName(CORE_EXECUTION_OPERATIONS_TOKEN),
  );
  let effects = 0;
  const code = (work: () => unknown, expected: string) =>
    assert.throws(work, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(Reflect.get(error, "code"), expected);
      return true;
    });
  code(
    () =>
      createApplication({
        providers: [],
        services: [valueService(CORE_EXECUTION_OPERATIONS_TOKEN, fake)],
      }),
    "SERVICE_GRAPH_RESERVED_TOKEN",
  );
  code(
    () =>
      createApplication({
        providers: [],
        overrides: [valueService(CORE_EXECUTION_OPERATIONS_TOKEN, fake)],
      }),
    "SERVICE_GRAPH_RESERVED_TOKEN",
  );
  code(
    () =>
      createApplication({
        providers: [
          {
            name: "never",
            setup() {
              effects++;
            },
          },
        ],
        services: [
          aliasService(Alias, CORE_EXECUTION_OPERATIONS_TOKEN),
          service(App, {
            lifetime: "application",
            dependencies: [Alias],
            create(value) {
              effects++;
              return value;
            },
          }),
        ],
      }),
    "SERVICE_GRAPH_CAPTIVE_DEPENDENCY",
  );
  assert.equal(effects, 0);
  const app = createApplication({
    providers: [],
    services: [valueService(SameLabel, fake), aliasService(Alias, CORE_EXECUTION_OPERATIONS_TOKEN)],
  });
  await app.start();
  let bound!: ExecutionOperations;
  await app.run((scope) => {
    bound = scope.resolve(Alias);
    assert.equal(scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN), bound);
    assert.equal(scope.resolve(SameLabel), fake);
  });
  assert.notEqual(bound, fake, "equal token labels never substitute reserved operations identity");
  assert.equal(Object.isFrozen(bound), true);
  assert.equal((await app.stop()).successful, true);
});

test("invoked operation errors are recoverable while actual returned body values retain identity", async () => {
  const marker = new AggregateError([undefined], "opaque ordinary failure");
  const value = {};
  const app = createApplication({ providers: [] });
  await app.start();
  let seen: unknown;
  let invalidWorkError: unknown;
  let active = false;
  let returned: unknown;
  let argumentsSeen = -1;
  const outcome = await app
    .run(async (scope) => {
      const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
      await operations.operation(1 as never).catch((error: unknown) => {
        invalidWorkError = error;
      });
      returned = await operations.operation((...args: unknown[]) => {
        argumentsSeen = args.length;
        operations.assertActive();
        active = true;
        return value;
      });
      return operations
        .operation(() => {
          throw marker;
        })
        .catch((error: unknown) => {
          seen = error;
          return "fallback";
        });
    })
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  assert.ok(outcome.ok, "caught ordinary operation work does not poison strict task ledger");
  assert.equal(outcome.value, "fallback");
  assert.ok(
    invalidWorkError instanceof TypeError,
    "invalid operation work rejects before admission without poisoning the run",
  );
  assert.equal(
    argumentsSeen,
    0,
    "operation work receives no implicit CommandScope or authority argument",
  );
  assert.equal(active, true);
  assert.equal(returned, value);
  assert.equal(seen, marker);
  assert.equal(Object.isFrozen(marker), false);
  assert.equal((await app.stop()).successful, true);
});

for (const kind of ["acquisition", "cleanup", "spawn"] as const) {
  test(`operation recovery does not suppress strict ${kind} failures`, async () => {
    const marker = Symbol(kind);
    const app = createApplication({ providers: [] });
    await app.start();
    let waiter: unknown;
    const failure = await rejected(
      app.run(async (scope) => {
        const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
        waiter = await operations.operation(async () => {
          if (kind === "acquisition")
            await scope
              .acquire({
                name: "failed",
                open: () => ({ ok: false, error: marker, disposition: "not-acquired" }),
                close() {},
              })
              .catch(() => {});
          if (kind === "cleanup")
            await scope.acquire({
              name: "owned",
              open: () => ({ ok: true, value: 1 }),
              close() {
                throw marker;
              },
            });
          if (kind === "spawn")
            await scope.spawn(() => {
              throw marker;
            });
          return 7;
        });
        return "caller succeeded";
      }),
    );
    assert.equal(waiter, 7);
    assert.equal(
      failure,
      marker,
      "ordinary operation success never recovers admitted acquisition cleanup or strict spawn occurrence",
    );
    assert.equal((await app.stop()).successful, kind !== "cleanup");
  });
}

test("reserved skipped operation settles its waiter and remains strict when caught", async () => {
  const external = new AbortController();
  const marker = Symbol("skip");
  const app = createApplication({ providers: [] });
  await app.start();
  let calls = 0;
  let observation: { pending?: true; ok?: boolean; error?: unknown } | undefined;
  const failure = await rejected(
    app.run({ kind: "command", signal: external.signal }, async (scope) => {
      const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
      const waiter = operations.operation(() => {
        calls++;
        return 7;
      });
      external.abort(marker);
      observation = await Promise.race([
        waiter.then(
          () => ({ ok: true }),
          (error: unknown) => ({ ok: false, error }),
        ),
        turn().then(() => ({ pending: true as const })),
      ]);
      return "caught skip";
    }),
  );
  assert.equal(calls, 0);
  assert.equal(failure, marker);
  assert.equal(
    observation?.pending,
    undefined,
    "reserved skipped operation waiter settles even when callback never executes",
  );
  assert.equal(observation?.ok, false);
  assert.equal(observation?.error, marker);
  assert.equal((await app.stop()).successful, true);
});

test("operation body observation settles before its actual nested subtree and execution cleanup", async () => {
  const Value = createServiceToken<string>("execution backing");
  const events: string[] = [];
  const entered = deferred();
  const release = deferred();
  const app = createApplication({
    providers: [],
    services: [
      resourceService(Value, {
        lifetime: "execution",
        dependencies: [],
        create: () => resource("execution", events),
      }),
    ],
  });
  await app.start();
  let observed: unknown;
  let saved!: CommandScope;
  const run = app.run(async (scope) => {
    saved = scope;
    const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    const waiter = operations.operation(() => {
      void operations.operation(async () => {
        entered.resolve();
        await release.promise;
      });
      return 7;
    });
    void waiter.then((value) => {
      observed = value;
    });
    await waiter;
    return 9;
  });
  try {
    await bounded(entered.promise);
    await turn();
    assert.equal(
      observed,
      7,
      "operation public waiter observes own body without waiting actual descendants",
    );
    await pending(run);
    assert.equal(
      events.includes("execution.close"),
      false,
      "actual operation subtree retains execution resource after waiter settles",
    );
    assert.throws(
      () => saved.resolve(Value),
      (error: unknown) => {
        expired(error);
        return true;
      },
    );
    release.resolve();
    assert.equal(await bounded(run), 9);
    assert.equal(events.filter((event) => event === "execution.close").length, 1);
  } finally {
    release.resolve();
    await app.stop();
  }
});

test("live child operation authority survives root return while detached inherited frames expire", async () => {
  const entered = deferred();
  const childRelease = deferred();
  const detached = deferred();
  const app = createApplication({ providers: [] });
  await app.start();
  let childValue: unknown;
  let detachedResult: { ok: boolean; error?: unknown } | undefined;
  let root!: CommandScope;
  const run = app.run((scope) => {
    root = scope;
    const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    void scope.spawn(async () => {
      entered.resolve();
      await childRelease.promise;
      childValue = await operations.operation(() => 9);
    });
    void operations.operation(() => {
      setImmediate(() => {
        void operations
          .operation(() => 1)
          .then(
            () => {
              detachedResult = { ok: true };
              detached.resolve();
            },
            (error: unknown) => {
              detachedResult = { ok: false, error };
              detached.resolve();
            },
          );
      });
    });
    return 7;
  });
  try {
    await bounded(entered.promise);
    await bounded(detached.promise);
    assert.equal(
      detachedResult?.ok,
      false,
      "detached operation frame cannot borrow a still-live execution lease",
    );
    expired(detachedResult?.error);
    assert.throws(
      () => root.resolve(CORE_EXECUTION_OPERATIONS_TOKEN),
      (error: unknown) => {
        expired(error);
        return true;
      },
    );
    childRelease.resolve();
    assert.equal(await bounded(run), 7);
    assert.equal(childValue, 9, "active child uses shared operations after root lease closes");
  } finally {
    childRelease.resolve();
    await app.stop();
  }
});

test("operations reject absent wrong-run and independent foreign-app frames without phantom children", async () => {
  const a = createApplication({ providers: [] });
  const b = createApplication({ providers: [] });
  await Promise.all([a.start(), b.start()]);
  const entered = deferred();
  const release = deferred();
  let first!: ExecutionOperations;
  let effects = 0;
  const run = a.run({ kind: "command", externalId: "same" }, async (scope) => {
    first = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    entered.resolve();
    await release.promise;
  });
  try {
    await bounded(entered.promise);
    const absent = attempt(() => first.assertActive());
    assert.equal(absent.ok, false);
    if (!absent.ok) expired(absent.error);
    expired(
      await rejected(
        first.operation(() => {
          effects++;
        }),
      ),
    );
    const errors = await Promise.all(
      [a, b].map((app) =>
        app.run({ kind: "command", externalId: "same" }, () =>
          first
            .operation(() => {
              effects++;
            })
            .then(
              () => undefined,
              (error: unknown) => error,
            ),
        ),
      ),
    );
    errors.forEach(expired);
    assert.equal(effects, 0, "wrong or absent execution authority never runs operation work");
    release.resolve();
    await bounded(run);
    const stale = attempt(() => first.assertActive());
    assert.equal(stale.ok, false);
    if (!stale.ok) expired(stale.error);
  } finally {
    release.resolve();
    await Promise.all([a.stop(), b.stop()]);
  }
});

test("explicit outer application operations stay outer-owned during nested application execution", async () => {
  const a = createApplication({ providers: [] });
  const b = createApplication({ providers: [] });
  await Promise.all([a.start(), b.start()]);
  const innerEntered = deferred();
  const innerRelease = deferred();
  const bDone = deferred();
  let bodyValue: unknown;
  let policy: unknown;
  const run = a.run({ kind: "job", actor: { kind: "system", policy: "A" } }, async (aScope) => {
    const boundA = aScope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    await b.run({ kind: "job", actor: { kind: "system", policy: "B" } }, async () => {
      bodyValue = await boundA.operation(() => {
        policy = aScope.context.actor;
        void boundA.operation(async () => {
          innerEntered.resolve();
          await innerRelease.promise;
        });
        return 7;
      });
    });
    bDone.resolve();
    return 9;
  });
  try {
    await bounded(innerEntered.promise);
    await bounded(bDone.promise);
    assert.equal(bodyValue, 7);
    assert.deepEqual(policy, { kind: "system", policy: "A" });
    await pending(run);
    assert.equal(b.state.phase, "ready", "nested B finishes without adopting A operation subtree");
    innerRelease.resolve();
    assert.equal(await bounded(run), 9, "outer A joins its actual operation subtree");
  } finally {
    innerRelease.resolve();
    await Promise.all([a.stop(), b.stop()]);
  }
});

test("same-app nested initializers and cleanup run blank instead of inheriting live outer authority", async () => {
  const Value = createServiceToken<number>("initializer");
  const Owned = createServiceToken<number>("cleanup");
  let outer: ExecutionOperations | undefined;
  const initial: ReturnType<typeof attempt>[] = [];
  const cleanup: Array<{ ok: boolean; error?: unknown }> = [];
  let effects = 0;
  const app = createApplication({
    providers: [],
    services: [
      service(Value, {
        lifetime: "execution",
        dependencies: [],
        create() {
          if (outer) initial.push(attempt(() => outer?.assertActive()));
          return 1;
        },
      }),
      resourceService(Owned, {
        lifetime: "execution",
        dependencies: [],
        create: () => ({
          name: "owned",
          open: () => ({ ok: true, value: 1 }),
          async close() {
            if (outer)
              cleanup.push(
                await outer
                  .operation(() => {
                    effects++;
                  })
                  .then(
                    () => ({ ok: true }),
                    (error: unknown) => ({ ok: false, error }),
                  ),
              );
          },
        }),
      }),
    ],
  });
  await app.start();
  await app.run(async (scope) => {
    outer = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    await app.run(() => 7);
  });
  assert.equal(initial.length, 1);
  assert.equal(
    initial[0]?.ok,
    false,
    "initializer cannot inherit same-app outer execution authority",
  );
  if (initial[0] && !initial[0].ok) expired(initial[0].error);
  assert.equal(cleanup.length, 2);
  cleanup.forEach((result) => {
    assert.equal(
      result.ok,
      false,
      "cleanup cannot admit operations through live same-app parent frame",
    );
    expired(result.error);
  });
  assert.equal(effects, 0);
  assert.equal((await app.stop()).successful, true);
});

test("operation invoke keeps child frame through descriptor then getter and native thenable jobs", async () => {
  const app = createApplication({ providers: [] });
  await app.start();
  const thenEntered = deferred();
  const release = deferred();
  const records: Array<ReturnType<typeof attempt>> = [];
  let reads = 0;
  let nested: unknown;
  let waiter!: Promise<unknown>;
  const run = app.run((scope) => {
    const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    // biome-ignore lint/suspicious/noThenProperty: Intentional callback thenable exercises native assimilation under child authority.
    const value = Object.defineProperty({}, "then", {
      get() {
        reads++;
        records.push(attempt(() => operations.assertActive()));
        return (resolve: (value: number) => void) => {
          records.push(attempt(() => operations.assertActive()));
          void operations
            .operation(() => 8)
            .then(
              (value) => {
                nested = value;
              },
              (error: unknown) => {
                nested = error;
              },
            );
          thenEntered.resolve();
          void release.promise.then(() => resolve(7));
        };
      },
    });
    const proxy = new Proxy(value, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "then") records.push(attempt(() => operations.assertActive()));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    waiter = operations.operation(() => proxy);
    return 9;
  });
  try {
    await bounded(thenEntered.promise);
    await pending(run);
    release.resolve();
    assert.equal(await bounded(run), 9);
    assert.equal(await bounded(waiter), 7);
    assert.equal(reads, 1, "operation reuses one native callback thenable assimilation");
    assert.ok(records.length >= 3);
    assert.equal(
      records.every((record) => record.ok),
      true,
      "whole operation invoke and thenable assimilation retain active child frame",
    );
    assert.equal(nested, 8);
  } finally {
    release.resolve();
    await app.stop();
  }
});

test("ignored operation failures and rejected admission observe their actual returned promises", async () => {
  const unhandled: unknown[] = [];
  const listener = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", listener);
  const app = createApplication({ providers: [] });
  let operations!: ExecutionOperations;
  try {
    await app.start();
    assert.equal(
      await app.run((scope) => {
        operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
        void operations.operation(() => {
          throw undefined;
        });
        return 7;
      }),
      7,
    );
    void operations.operation(() => 9);
    await turn();
    await turn();
    assert.deepEqual(
      unhandled,
      [],
      "ignored actual operation promises never leak ordinary or admission rejections",
    );
  } finally {
    await app.stop();
    process.off("unhandledRejection", listener);
  }
});

test("task resource cleanup cannot inherit still-active parent operation authority", async () => {
  const app = createApplication({ providers: [] });
  await app.start();
  let sync: ReturnType<typeof attempt> | undefined;
  let admission: { ok: boolean; error?: unknown } | undefined;
  let effects = 0;
  let childSucceeded = false;
  const result = await app.run(async (root) => {
    const saved = root.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    const child = await root.spawn(async (scope) => {
      await scope.acquire({
        name: "child-owned",
        open: () => ({ ok: true, value: 1 }),
        async close() {
          sync = attempt(() => saved.assertActive());
          admission = await saved
            .operation(() => {
              effects++;
            })
            .then(
              () => ({ ok: true }),
              (error: unknown) => ({ ok: false, error }),
            );
        },
      });
    });
    childSucceeded = child.ok;
    return 7;
  });
  assert.equal(result, 7);
  assert.equal(childSucceeded, true);
  assert.equal(
    sync?.ok,
    false,
    "task resource cleanup runs blank while its parent body is still active",
  );
  if (sync && !sync.ok) expired(sync.error);
  assert.equal(
    admission?.ok,
    false,
    "task cleanup cannot launch operations through inherited active parent frame",
  );
  expired(admission?.error);
  assert.equal(effects, 0);
  assert.equal((await app.stop()).successful, true);
});
