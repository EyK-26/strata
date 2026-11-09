import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { type Application, createApplication } from "@getstrata/core/runtime/application";
import {
  bounded,
  deferred,
  pending,
  rejected,
  resource,
} from "../fixtures/applicationOwnershipSupport";

test("fresh source public import and construction start no listener, worker, producer or signal owner", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../fixtures/applicationOwnershipConsumer.ts"),
      "source-import",
    ],
    {
      cwd: join(import.meta.dir, "../.."),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exit, 0, `Source import child failed: ${stdout}\n${stderr}`);
  assert.equal(JSON.parse(stdout.trim()).importEffects, 0);
});

test("construction validates declarations without invoking setup or opening resources", async () => {
  let effects = 0;
  const setup = () => {
    effects++;
  };
  const invalid = [
    { providers: [{ name: "a", requires: ["missing"], setup }] },
    {
      providers: [
        { name: "a", requires: ["b"], setup },
        { name: "b", requires: ["a"], setup },
      ],
    },
    { providers: [{ name: "same", setup }], transports: [{ name: "same", setup }] },
    ...[0, -1, NaN, Infinity, 1.5, 2_147_483_648].flatMap((value) => [
      { providers: [], shutdownTimeoutMs: value },
      { providers: [], startupCleanupTimeoutMs: value },
    ]),
  ];
  for (const definition of invalid) assert.throws(() => createApplication(definition));
  const app = createApplication({ providers: [{ name: "a", setup }] });
  assert.equal(effects, 0);
  assert.equal(app.state.phase, "constructed");
  assert.equal(app.state.boot, "not-started");
  assert.equal(app.state.cleanup, "not-required");
  assert.deepEqual(app.state.pendingAcquisitions, []);
  assert.deepEqual(app.state.retainedResources, []);
  assert.ok(Object.isFrozen(app.state));
  assert.ok(Object.isFrozen(app.state.errors));
  const first = app.stop();
  assert.equal(app.stop(), first);
  assert.equal((await bounded(first)).successful, true);
  assert.equal((await bounded(app.completion)).snapshot.cleanup, "clean");
  await rejected(app.start());
  assert.equal(effects, 0);
});

test("invalid runtime declarations and non-plain configuration fail before effects", () => {
  let effects = 0;
  const setup = () => {
    effects++;
  };
  const construct = createApplication as (definition: unknown) => Application;
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      effects++;
      throw new Error("configuration accessor executed");
    },
  });
  const invalid: unknown[] = [
    null,
    {},
    { providers: null },
    { providers: [{ name: "same" }] },
    { providers: [{ name: "", setup }] },
    { providers: [{ name: 7, setup }] },
    { providers: [{ name: "same", requires: "other", setup }] },
    { providers: [null] },
    { providers: [{ name: "same", setup: 1 }] },
    { providers: [{ name: "same", requires: [1], setup }] },
    { providers: [{ name: "same", requires: ["same"], setup }] },
    { providers: [], transports: null },
    {
      providers: [{ name: "api", requires: ["http"], setup }],
      transports: [{ name: "http", setup }],
    },
    { providers: [], transports: [{ name: "http", requires: ["missing"], setup }] },
    ...[
      null,
      0,
      [],
      new Map(),
      new Date(),
      cycle,
      accessor,
      { function: setup },
      { symbol: Symbol("mutable") },
      { undefined },
      { infinite: Infinity },
      { nan: NaN },
      { sparse: Array(2) },
      Object.create({ inherited: true }),
      Object.defineProperty({}, "hidden", { value: "not public", enumerable: false }),
      { [Symbol("hidden")]: "not public" },
    ].map((config) => ({ providers: [{ name: "same", setup }], config })),
  ];
  for (const definition of invalid) assert.throws(() => construct(definition));
  assert.equal(effects, 0);
});

test("plain arrays and nested configuration are immutable snapshots rather than caller objects", async () => {
  const shared = { name: "owned" };
  const plain = Object.assign(Object.create(null), { flag: true }) as { flag: boolean };
  const config = { values: [1, true, null, shared], first: shared, second: shared, plain };
  const app = createApplication({ config, providers: [] });
  config.values.splice(0, config.values.length);
  try {
    await app.start();
    await app.run((scope) => {
      assert.deepEqual(scope.config.values, [1, true, null, { name: "owned" }]);
      assert.ok(Object.isFrozen(scope.config.values));
      assert.notEqual(scope.config, config);
      assert.deepEqual(scope.config.first, { name: "owned" });
      assert.deepEqual(scope.config.second, { name: "owned" });
      assert.equal((scope.config.plain as { flag: boolean }).flag, true);
    });
  } finally {
    await bounded(app.stop());
  }
});

test("configuration is copied/frozen and start waits for owned setup before readiness", async () => {
  const gate = deferred();
  const entered = deferred();
  const config = { label: "first", nested: { value: "original" } };
  let calls = 0;
  let reentered: Promise<void> | undefined;
  let app!: Application;
  app = createApplication({
    config,
    providers: [
      {
        name: "same",
        async setup(scope) {
          calls++;
          reentered = app.start();
          assert.equal(scope.applicationId, app.id);
          assert.equal(scope.config.label, "first");
          assert.deepEqual(scope.config.nested, { value: "original" });
          assert.ok(Object.isFrozen(scope.config.nested));
          entered.resolve();
          await gate.promise;
        },
      },
    ],
  });
  config.label = "changed";
  config.nested.value = "changed";
  const first = app.start();
  assert.equal(app.start(), first);
  try {
    await bounded(entered.promise);
    assert.equal(reentered, first);
    assert.equal(app.state.phase, "starting");
    await pending(first);
    gate.resolve();
    await bounded(first);
    assert.equal(app.start(), first);
    assert.equal(calls, 1);
    assert.equal(app.state.phase, "ready");
    assert.equal(app.state.cleanup, "open");
  } finally {
    gate.resolve();
    await bounded(app.stop());
  }
});

test("start after stopping rejects without rewriting the previous successful start", async () => {
  const events: string[] = [];
  const closeGate = deferred();
  const closeEntered = deferred();
  const app = createApplication({
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire(
            resource("same", events, {
              async close() {
                events.push("same.close");
                closeEntered.resolve();
                await closeGate.promise;
              },
            }),
          );
        },
      },
    ],
  });
  const original = app.start();
  await bounded(original);
  const stop = app.stop();
  try {
    await bounded(closeEntered.promise);
    const terminal = app.start();
    assert.notEqual(terminal, original);
    assert.equal(app.start(), terminal);
    await rejected(terminal);
    await original;
    closeGate.resolve();
    assert.equal((await bounded(stop)).successful, true);
    assert.equal(app.start(), terminal);
    await rejected(app.start());
    assert.equal(app.state.phase, "stopped");
    assert.equal(events.filter((value) => value === "same.open").length, 1);
  } finally {
    closeGate.resolve();
    await bounded(stop);
  }
});

test("stop is cached before synchronous reentry and the first reason wins", async () => {
  const reasons: string[] = [];
  let reentered: Promise<unknown> | undefined;
  let app!: Application;
  app = createApplication({
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire({
            name: "same",
            open: () => ({ ok: true, value: 1 }),
            stop(_value, context) {
              reasons.push(context.reason);
              reentered = app.stop({ reason: "reentry" });
            },
            close() {
              reasons.push("closed");
            },
          });
        },
      },
    ],
  });
  await app.start();
  const first = app.stop({ reason: "first" });
  assert.equal(app.stop({ reason: "second" }), first);
  assert.equal((await bounded(first)).successful, true);
  assert.equal(reentered, first);
  assert.deepEqual(reasons, ["first", "closed"]);
  assert.equal(app.stop(), first);
});

test("owned no-HTTP commands close admission synchronously and drain before close", async () => {
  const workGate = deferred();
  const entered = deferred();
  const events: string[] = [];
  const app = createApplication({
    config: { value: "owned" },
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire(resource("same", events));
        },
      },
    ],
  });
  await rejected(app.run(() => "too early"));
  await app.start();
  const work = app.run(async (scope) => {
    assert.equal(scope.applicationId, app.id);
    assert.equal(scope.config.value, "owned");
    entered.resolve();
    await workGate.promise;
    assert.equal(events.includes("same.close"), false);
    return scope.config.value;
  });
  await entered.promise;
  const stop = app.stop();
  try {
    await rejected(app.run(() => assert.fail("New command admitted after stop")));
    await pending(stop);
    assert.equal(events.includes("same.close"), false);
    workGate.resolve();
    assert.equal(await bounded(work), "owned");
    assert.equal((await bounded(stop)).successful, true);
    assert.equal(events.at(-1), "same.close");
  } finally {
    workGate.resolve();
    await bounded(stop);
  }
});

for (const primary of [undefined, null, 0]) {
  test(`falsy startup rejection is retained as an opaque primary (${String(primary)})`, async () => {
    const app = createApplication({
      providers: [
        {
          name: "same",
          setup() {
            if (primary === null) return Promise.reject(primary);
            throw primary;
          },
        },
      ],
    });
    assert.equal(await rejected(app.start()), primary);
    const completion = await bounded(app.completion);
    assert.equal(completion.snapshot.boot, "failed");
    assert.ok(
      completion.snapshot.errors.some(
        (entry) => entry.kind === "startup" && entry.error === primary,
      ),
    );
    await rejected(app.start());
  });
}

test("a rejected admitted command preserves its caller error and still releases drain ownership", async () => {
  const gate = deferred();
  const entered = deferred();
  const primary = Object.freeze({ command: "opaque failure" });
  let closed = 0;
  const app = createApplication({
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire({
            name: "same",
            open: () => ({ ok: true, value: 1 }),
            close() {
              closed++;
            },
          });
        },
      },
    ],
  });
  await app.start();
  const work = app.run(async () => {
    entered.resolve();
    await gate.promise;
    throw primary;
  });
  try {
    await bounded(entered.promise);
    const stop = app.stop();
    await pending(stop);
    assert.equal(closed, 0);
    gate.resolve();
    assert.equal(await rejected(work), primary);
    assert.equal((await bounded(stop)).snapshot.cleanup, "clean");
    assert.equal(closed, 1);
  } finally {
    gate.resolve();
    await bounded(app.stop());
  }
});
