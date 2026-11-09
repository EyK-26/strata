import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  type Application,
  createApplication,
  type OpenOutcome,
  type ProviderScope,
} from "@getstrata/core/runtime/application";
import {
  bounded,
  deferred,
  listenerFixture,
  pending,
  rejected,
  resource,
} from "../fixtures/applicationOwnershipSupport";

test("one owner runs phases in dependency order and releases resources LIFO exactly once", async () => {
  const events: string[] = [];
  const app = createApplication({
    providers: [
      {
        name: "dependent",
        requires: ["backing"],
        async setup(scope) {
          const firstOpen = deferred<OpenOutcome<string>>();
          const secondOpen = deferred<OpenOutcome<string>>();
          const first = scope.acquire(
            resource("B1", events, {
              open() {
                events.push("B1.open");
                return firstOpen.promise;
              },
            }),
          );
          const second = scope.acquire(
            resource("B2", events, {
              open() {
                events.push("B2.open");
                return secondOpen.promise;
              },
            }),
          );
          secondOpen.resolve({ ok: true, value: "B2" });
          await second;
          events.push("B2.acquired");
          firstOpen.resolve({ ok: true, value: "B1" });
          await first;
          events.push("B1.acquired");
        },
      },
      {
        name: "backing",
        async setup(scope) {
          await scope.acquire(resource("A", events));
        },
      },
    ],
  });
  await app.start();
  const stop = app.stop();
  assert.equal(app.stop(), stop);
  const result = await bounded(stop);
  assert.equal(result.successful, true);
  assert.deepEqual(events, [
    "A.open",
    "B1.open",
    "B2.open",
    "B2.acquired",
    "B1.acquired",
    ...["stop", "drain", "flush", "close"].flatMap((phase) =>
      ["B2", "B1", "A"].map((name) => `${name}.${phase}`),
    ),
  ]);
  assert.deepEqual(result.snapshot.retainedResources, []);
  assert.equal((await app.completion).snapshot.cleanup, "clean");
});

test("duplicate resource registration cannot overwrite an existing disposal obligation", async () => {
  const events: string[] = [];
  let secondOpen = 0;
  const app = createApplication({
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire(resource("same", events));
          await scope.acquire(
            resource("same", events, {
              open() {
                secondOpen++;
                return { ok: true, value: "replacement" };
              },
            }),
          );
        },
      },
    ],
  });
  await rejected(app.start());
  assert.equal(secondOpen, 0);
  assert.equal(events.filter((value) => value === "same.close").length, 1);
  assert.equal((await bounded(app.completion)).snapshot.boot, "failed");
});

for (const boundary of ["before-first", "after-first", "after-second", "transport"] as const) {
  test(`startup failure at ${boundary} cleans only resources already acquired`, async () => {
    const primary = new Error(`primary:${boundary}`);
    const events: string[] = [];
    let forbidden = 0;
    const app = createApplication({
      providers: [
        {
          name: "A",
          async setup(scope) {
            if (boundary === "before-first") throw primary;
            await scope.acquire(resource("A", events));
            if (boundary === "after-first") throw primary;
          },
        },
        {
          name: "B",
          requires: ["A"],
          async setup(scope) {
            await scope.acquire(resource("B", events));
            if (boundary === "after-second") throw primary;
          },
        },
      ],
      transports: [
        {
          name: "transport",
          setup() {
            throw primary;
          },
        },
        {
          name: "unstarted",
          setup() {
            forbidden++;
          },
        },
      ],
    });
    assert.equal(await rejected(app.start()), primary);
    const done = await bounded(app.completion);
    assert.equal(done.snapshot.boot, "failed");
    assert.equal(done.snapshot.cleanup, "clean");
    assert.equal(forbidden, 0);
    assert.deepEqual(
      events.filter((value) => value.endsWith(".close")),
      boundary === "before-first"
        ? []
        : boundary === "after-first"
          ? ["A.close"]
          : ["B.close", "A.close"],
    );
  });
}

test("independent flush/close errors preserve primary and other safe cleanup", async () => {
  const primary = new Error("startup");
  const flush = new Error("flush");
  const close = new Error("close");
  const events: string[] = [];
  const app = createApplication({
    providers: [
      {
        name: "independent",
        async setup(scope) {
          await scope.acquire(resource("safe", events));
        },
      },
      {
        name: "broken",
        async setup(scope) {
          await scope.acquire(
            resource("broken", events, {
              flush() {
                throw flush;
              },
              close() {
                throw close;
              },
            }),
          );
          throw primary;
        },
      },
    ],
  });
  const failure = await rejected(app.start());
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.cause, primary);
  const done = await bounded(app.completion);
  for (const error of [primary, flush, close])
    assert.ok(done.snapshot.errors.some((entry) => entry.error === error));
  assert.equal(done.successful, false);
  assert.equal(done.snapshot.cleanup, "failed");
  assert.equal(events.filter((value) => value === "safe.close").length, 1);
});

test("unconfirmed dependent close retains its backing provider while unrelated cleanup continues", async () => {
  const events: string[] = [];
  const failure = new Error("dependent close unconfirmed");
  const app = createApplication({
    providers: [
      {
        name: "C",
        async setup(scope) {
          await scope.acquire(resource("C", events));
        },
      },
      {
        name: "B",
        async setup(scope) {
          await scope.acquire(resource("B", events));
        },
      },
      {
        name: "A",
        requires: ["B"],
        async setup(scope) {
          await scope.acquire(
            resource("A", events, {
              close() {
                events.push("A.close");
                throw failure;
              },
            }),
          );
        },
      },
    ],
  });
  await app.start();
  const result = await bounded(app.stop());
  assert.equal(result.successful, false);
  assert.equal(result.snapshot.cleanup, "failed");
  assert.ok(result.snapshot.errors.some((entry) => entry.error === failure));
  assert.equal(events.filter((event) => event === "A.close").length, 1);
  assert.equal(events.includes("B.close"), false);
  assert.equal(events.filter((event) => event === "C.close").length, 1);
  assert.ok(result.snapshot.retainedResources.length >= 2);
});

test("interleaved apps with identical names keep config, commands and real listeners isolated", async () => {
  const eventsA: string[] = [];
  const eventsB: string[] = [];
  let appA!: Application;
  let appB!: Application;
  const listenerA = listenerFixture(
    () => appA,
    (scope) => new Response(String(scope.config.value)),
  );
  const listenerB = listenerFixture(
    () => appB,
    (scope) => new Response(String(scope.config.value)),
  );
  const definition = (value: string, events: string[]) => ({
    config: { value },
    providers: [
      {
        name: "same",
        async setup(scope: ProviderScope) {
          assert.equal(scope.config.value, value);
          await scope.acquire(resource("same", events));
        },
      },
    ],
  });
  appA = createApplication({ ...definition("A", eventsA), transports: [listenerA.transport] });
  appB = createApplication({ ...definition("B", eventsB), transports: [listenerB.transport] });
  try {
    await Promise.all([appB.start(), appA.start()]);
    assert.notEqual(appA.id, appB.id);
    assert.equal(await (await fetch(listenerA.url())).text(), "A");
    assert.equal(await (await fetch(listenerB.url())).text(), "B");
    assert.equal(await appA.run((scope) => scope.config.value), "A");
    assert.equal(await appB.run((scope) => scope.config.value), "B");
    assert.equal((await bounded(appA.stop())).successful, true);
    assert.equal(eventsB.includes("same.close"), false);
    assert.equal(await (await fetch(listenerB.url())).text(), "B");
    assert.equal(await appB.run((scope) => scope.applicationId), appB.id);
    await rejected(appA.start());
    assert.equal((await bounded(appB.stop())).successful, true);
    assert.equal(eventsA.filter((value) => value === "same.close").length, 1);
    assert.equal(eventsB.filter((value) => value === "same.close").length, 1);
    const fresh = createApplication(definition("C", []));
    await fresh.start();
    assert.equal(await fresh.run((scope) => scope.config.value), "C");
    await fresh.stop();
  } finally {
    await Promise.all([listenerA.recover(), listenerB.recover()]);
    await Promise.all([bounded(appA.stop()), bounded(appB.stop())]);
  }
});

test("actual occupied-port failure remains primary when provider cleanup also fails", async () => {
  const occupier = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("occupier"),
  });
  const cleanup = new Error("provider cleanup");
  let app!: Application;
  const listener = listenerFixture(
    () => app,
    () => new Response("candidate"),
    { port: occupier.port },
  );
  let closeCalls = 0;
  app = createApplication({
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire({
            name: "same",
            open: () => ({ ok: true, value: 1 }),
            close() {
              closeCalls++;
              throw cleanup;
            },
          });
        },
      },
    ],
    transports: [listener.transport],
  });
  try {
    const error = await rejected(app.start());
    assert.ok(error instanceof AggregateError);
    const primary = error.cause;
    assert.ok(primary instanceof Error);
    assert.equal(Reflect.get(primary, "code"), "EADDRINUSE");
    const done = await bounded(app.completion);
    assert.ok(done.snapshot.errors.some((entry) => entry.error === primary));
    assert.ok(done.snapshot.errors.some((entry) => entry.error === cleanup));
    assert.equal(done.successful, false);
    assert.equal(closeCalls, 1);
    assert.equal(listener.acquired, 0);
    assert.equal(await (await fetch(occupier.url)).text(), "occupier");
  } finally {
    await listener.recover();
    await occupier.stop(true);
    await bounded(app.stop());
  }
});

test("a real admitted HTTP handler drains before its backing resource closes", async () => {
  const entered = deferred();
  const gate = deferred();
  let closed = 0;
  let app!: Application;
  const listener = listenerFixture(
    () => app,
    async () => {
      entered.resolve();
      await gate.promise;
      assert.equal(closed, 0);
      return new Response("finished admitted work");
    },
  );
  app = createApplication({
    providers: [
      {
        name: "backing",
        async setup(scope) {
          await scope.acquire({
            name: "backing",
            open: () => ({ ok: true, value: 1 }),
            close() {
              closed++;
            },
          });
        },
      },
    ],
    transports: [listener.transport],
  });
  let request: Promise<Response> | undefined;
  try {
    await app.start();
    request = fetch(listener.url());
    await bounded(entered.promise);
    const stopping = app.stop();
    await pending(stopping);
    assert.equal(closed, 0);
    await rejected(app.run(() => assert.fail("Admission remained open")));
    gate.resolve();
    assert.equal(await (await bounded(request)).text(), "finished admitted work");
    assert.equal((await bounded(stopping)).successful, true);
    assert.equal(closed, 1);
    assert.equal(listener.stopCalls, 1);
    assert.equal(listener.closeCalls, 1);
  } finally {
    gate.resolve();
    await listener.recover();
    await request?.catch(() => {});
    await bounded(app.stop());
  }
});

test("failed real-listener stop cannot close infrastructure beneath an admitted handler", async () => {
  const entered = deferred();
  const gate = deferred();
  const stopFailure = new Error("admission stop unconfirmed");
  let closed = 0;
  let flushed = 0;
  let app!: Application;
  const listener = listenerFixture(
    () => app,
    async () => {
      entered.resolve();
      await gate.promise;
      assert.equal(closed, 0);
      return new Response("still owns backing resource");
    },
    {
      stop() {
        throw stopFailure;
      },
    },
  );
  app = createApplication({
    shutdownTimeoutMs: 40,
    providers: [
      {
        name: "backing",
        async setup(scope) {
          await scope.acquire({
            name: "backing",
            open: () => ({ ok: true, value: 1 }),
            flush() {
              flushed++;
            },
            close() {
              closed++;
            },
          });
        },
      },
    ],
    transports: [listener.transport],
  });
  let request: Promise<Response> | undefined;
  try {
    await app.start();
    request = fetch(listener.url());
    await bounded(entered.promise);
    const stop = app.stop();
    await pending(app.completion);
    assert.equal(closed, 0);
    gate.resolve();
    assert.equal(await (await bounded(request)).text(), "still owns backing resource");
    const outcome = await bounded(stop);
    const done = await bounded(app.completion);
    assert.equal(outcome.successful, false);
    assert.equal(done.snapshot.cleanup, "failed");
    assert.ok(done.snapshot.errors.some((entry) => entry.error === stopFailure));
    assert.equal(flushed, 0);
    assert.equal(closed, 0);
    assert.ok(done.snapshot.retainedResources.length > 0);
    assert.equal(listener.acquired, 1);
    assert.equal(listener.closeCalls, 0);
  } finally {
    gate.resolve();
    await listener.recover();
    await request?.catch(() => {});
    await bounded(app.stop());
  }
});

test("hanging real-listener stop and disconnected work both retain backing infrastructure", async () => {
  const handlerEntered = deferred();
  const handlerGate = deferred();
  const stopEntered = deferred();
  const stopGate = deferred();
  let closed = 0;
  let app!: Application;
  const listener = listenerFixture(
    () => app,
    async () => {
      handlerEntered.resolve();
      await handlerGate.promise;
      assert.equal(closed, 0);
      return new Response("handler settled");
    },
    {
      async stop(server) {
        stopEntered.resolve();
        await stopGate.promise;
        await server.stop(false);
      },
    },
  );
  app = createApplication({
    shutdownTimeoutMs: 25,
    providers: [
      {
        name: "backing",
        async setup(scope) {
          await scope.acquire({
            name: "backing",
            open: () => ({ ok: true, value: 1 }),
            close() {
              closed++;
            },
          });
        },
      },
    ],
    transports: [listener.transport],
  });
  let request: Promise<unknown> | undefined;
  try {
    await app.start();
    request = fetch(listener.url()).then(
      (response) => response.text(),
      (error: unknown) => error,
    );
    await bounded(handlerEntered.promise);
    const stopping = app.stop();
    await bounded(stopEntered.promise);
    const result = await bounded(stopping);
    assert.equal(result.timedOut, true);
    assert.equal(result.snapshot.cleanup, "pending");
    assert.equal(closed, 0);
    await pending(app.completion);
    // Fixture-owned forced socket recovery is not proof that business work ended.
    await listener.recover();
    stopGate.resolve();
    await pending(app.completion);
    assert.equal(closed, 0);
    handlerGate.resolve();
    assert.equal((await bounded(app.completion)).snapshot.cleanup, "clean");
    assert.equal(closed, 1);
    assert.equal(result.snapshot.cleanup, "pending");
  } finally {
    stopGate.resolve();
    handlerGate.resolve();
    await listener.recover();
    await request;
    await bounded(app.completion);
  }
});

for (const interleaving of ["A-fails-during-B-start", "A-returns-late-after-B-ready"] as const) {
  test(`same-name application isolation survives ${interleaving}`, async () => {
    const bEntered = deferred();
    const bGate = deferred();
    const aEntered = deferred();
    const aOpen = deferred<OpenOutcome<string>>();
    const eventsA: string[] = [];
    const eventsB: string[] = [];
    const primary = new Error("A startup failure");
    let appB!: Application;
    const listenerB = listenerFixture(
      () => appB,
      (scope) => new Response(String(scope.config.value)),
    );
    appB = createApplication({
      config: { value: "B" },
      providers: [
        {
          name: "same",
          async setup(scope) {
            assert.equal(scope.config.value, "B");
            await scope.acquire(resource("same", eventsB));
            bEntered.resolve();
            await bGate.promise;
          },
        },
      ],
      transports: [listenerB.transport],
    });
    const appA = createApplication({
      shutdownTimeoutMs: 25,
      config: { value: "A" },
      providers: [
        {
          name: "same",
          async setup(scope) {
            assert.equal(scope.config.value, "A");
            await scope.acquire(
              resource(
                "same",
                eventsA,
                interleaving === "A-fails-during-B-start"
                  ? {}
                  : {
                      open() {
                        aEntered.resolve();
                        return aOpen.promise;
                      },
                    },
              ),
            );
            if (interleaving === "A-fails-during-B-start") throw primary;
          },
        },
      ],
    });
    const bStart = appB.start();
    try {
      await bounded(bEntered.promise);
      if (interleaving === "A-fails-during-B-start") {
        assert.equal(await rejected(appA.start()), primary);
        assert.equal(appB.state.phase, "starting");
        assert.equal(eventsB.includes("same.close"), false);
        bGate.resolve();
        await bounded(bStart);
      } else {
        bGate.resolve();
        await bounded(bStart);
        const aStart = appA.start();
        await bounded(aEntered.promise);
        const stop = await bounded(appA.stop());
        assert.equal(stop.timedOut, true);
        assert.equal(await (await fetch(listenerB.url())).text(), "B");
        aOpen.resolve({ ok: true, value: "A late resource" });
        await rejected(aStart);
      }
      assert.equal((await bounded(appA.completion)).snapshot.cleanup, "clean");
      assert.equal(appB.state.phase, "ready");
      assert.equal(eventsB.includes("same.close"), false);
      assert.equal(await (await fetch(listenerB.url())).text(), "B");
      assert.equal(await appB.run((scope) => scope.config.value), "B");
      assert.equal(eventsA.filter((event) => event === "same.close").length, 1);
      await bounded(appB.stop());
      assert.equal(eventsB.filter((event) => event === "same.close").length, 1);
    } finally {
      bGate.resolve();
      aOpen.resolve({ ok: true, value: "A late resource" });
      await listenerB.recover();
      await Promise.all([bounded(appA.stop()), bounded(appB.stop())]);
    }
  });
}

test("actual occupied-port failure rejects directly and confirms provider cleanup", async () => {
  const occupier = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("occupier"),
  });
  const events: string[] = [];
  let app!: Application;
  const listener = listenerFixture(
    () => app,
    () => new Response("candidate"),
    { port: occupier.port },
  );
  app = createApplication({
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire(resource("same", events));
        },
      },
    ],
    transports: [listener.transport],
  });
  try {
    const primary = await rejected(app.start());
    assert.ok(primary instanceof Error);
    assert.equal(primary instanceof AggregateError, false);
    assert.equal(Reflect.get(primary, "code"), "EADDRINUSE");
    assert.equal((await bounded(app.completion)).snapshot.cleanup, "clean");
    assert.equal(events.filter((event) => event === "same.close").length, 1);
    assert.equal(listener.acquired, 0);
    assert.equal(await (await fetch(occupier.url)).text(), "occupier");
  } finally {
    await listener.recover();
    await occupier.stop(true);
    await bounded(app.stop());
  }
});

for (const failureMode of ["unknown-open", "failed-close"] as const) {
  test(`transport ${failureMode} retains all implicit provider dependencies`, async () => {
    const marker = new Error(`transport:${failureMode}`);
    const events: string[] = [];
    const app = createApplication({
      providers: [
        {
          name: "A",
          async setup(scope) {
            await scope.acquire(resource("A", events));
          },
        },
        {
          name: "B",
          async setup(scope) {
            await scope.acquire(resource("B", events));
          },
        },
      ],
      transports: [
        {
          name: "transport",
          async setup(scope) {
            await scope.acquire<string>({
              name: "transport",
              open() {
                if (failureMode === "unknown-open") throw marker;
                return { ok: true, value: "transport" };
              },
              close() {
                throw marker;
              },
            });
          },
        },
      ],
    });
    if (failureMode === "unknown-open") assert.equal(await rejected(app.start()), marker);
    else {
      await app.start();
      await bounded(app.stop());
    }
    const done = await bounded(app.completion);
    assert.equal(done.successful, false);
    assert.equal(done.snapshot.cleanup, "failed");
    assert.ok(done.snapshot.errors.some((entry) => entry.error === marker));
    assert.equal(events.includes("A.close"), false);
    assert.equal(events.includes("B.close"), false);
    assert.ok(done.snapshot.retainedResources.length >= 3);
  });
}
