import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  createApplication,
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

test("a late producer is stopped even when open settles during another stop hook", async () => {
  const openEntered = deferred();
  const openOutcome = deferred<OpenOutcome<string>>();
  const setupSettled = deferred();
  const stopEntered = deferred();
  const stopGate = deferred();
  const events: string[] = [];
  const app = createApplication({
    providers: [
      {
        name: "A",
        async setup(scope) {
          await scope.acquire(
            resource("A", events, {
              async stop() {
                events.push("A.stop");
                stopEntered.resolve();
                await stopGate.promise;
              },
            }),
          );
        },
      },
    ],
    transports: [
      {
        name: "B",
        requires: ["A"],
        async setup(scope) {
          try {
            await scope.acquire(
              resource("B", events, {
                open() {
                  openEntered.resolve();
                  return openOutcome.promise;
                },
              }),
            );
          } finally {
            setupSettled.resolve();
          }
        },
      },
    ],
  });
  const startup = app.start();
  try {
    await bounded(openEntered.promise);
    const stopping = app.stop();
    await bounded(stopEntered.promise, "already-acquired producer stop");
    openOutcome.resolve({ ok: true, value: "late producer" });
    await bounded(setupSettled.promise, "late transport setup settlement");
    stopGate.resolve();
    await rejected(startup);
    assert.equal((await bounded(stopping)).snapshot.cleanup, "clean");
    assert.equal(events.filter((event) => event === "B.stop").length, 1);
    const lateStop = events.indexOf("B.stop");
    for (const later of ["B.drain", "B.flush", "B.close", "A.close"]) {
      assert.ok(events.indexOf(later) > lateStop, `${later} ran without late producer stop`);
    }
  } finally {
    openOutcome.resolve({ ok: true, value: "late producer" });
    stopGate.resolve();
    await bounded(app.completion);
  }
});

test("stop owns an acquired resource without closing beneath unfinished provider setup", async () => {
  const entered = deferred();
  const gate = deferred();
  const events: string[] = [];
  const app = createApplication({
    shutdownTimeoutMs: 25,
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire(resource("same", events));
          entered.resolve();
          await gate.promise;
          assert.equal(events.includes("same.close"), false);
        },
      },
    ],
  });
  const startup = app.start();
  try {
    await bounded(entered.promise);
    const originalCompletion = app.completion;
    const stop = await bounded(app.stop());
    assert.equal(stop.timedOut, true);
    assert.equal(stop.successful, false);
    assert.equal(stop.snapshot.cleanup, "pending");
    assert.equal(app.completion, originalCompletion);
    await pending(app.completion);
    assert.equal(events.includes("same.close"), false);
    assert.ok(stop.snapshot.retainedResources.length > 0);
    gate.resolve();
    await rejected(startup);
    const done = await bounded(app.completion);
    assert.equal(done.snapshot.cleanup, "clean");
    assert.equal(events.filter((value) => value === "same.close").length, 1);
    assert.equal(stop.snapshot.cleanup, "pending");
    assert.equal(stop.timedOut, true);
    assert.ok(Object.isFrozen(stop));
    assert.ok(Object.isFrozen(stop.snapshot));
  } finally {
    gate.resolve();
    await bounded(app.completion);
  }
});

for (const late of ["success", "explicit-failure", "raw-rejection"] as const) {
  test(`cancelled in-flight open remains owned through late ${late}`, async () => {
    const entered = deferred();
    const outcome = deferred<OpenOutcome<string>>();
    const marker = new Error(`late:${late}`);
    let returnedToSetup = 0;
    let closed = 0;
    let downstream = 0;
    const app = createApplication({
      shutdownTimeoutMs: 25,
      providers: [
        {
          name: "same",
          async setup(scope) {
            await scope.acquire({
              name: "same",
              open() {
                entered.resolve();
                return outcome.promise;
              },
              close() {
                closed++;
              },
            });
            returnedToSetup++;
          },
        },
        {
          name: "downstream",
          setup() {
            downstream++;
          },
        },
      ],
    });
    const startup = app.start();
    try {
      await entered.promise;
      const stop = await bounded(app.stop());
      assert.equal(stop.timedOut, true);
      assert.ok(stop.snapshot.pendingAcquisitions.length > 0);
      await pending(app.completion);
      if (late === "success") outcome.resolve({ ok: true, value: "late resource" });
      else if (late === "explicit-failure")
        outcome.resolve({ ok: false, error: marker, disposition: "not-acquired" });
      else outcome.reject(marker);
      await rejected(startup);
      const done = await bounded(app.completion);
      assert.equal(returnedToSetup, 0);
      assert.equal(downstream, 0);
      assert.equal(closed, late === "success" ? 1 : 0);
      assert.equal(done.snapshot.cleanup, late === "raw-rejection" ? "failed" : "clean");
      if (late !== "success")
        assert.ok(done.snapshot.errors.some((entry) => entry.error === marker));
      if (late === "raw-rejection") assert.ok(done.snapshot.retainedResources.length > 0);
      assert.ok(stop.snapshot.pendingAcquisitions.length > 0, "Delivered result was mutated");
      assert.equal(stop.snapshot.cleanup, "pending");
    } finally {
      outcome.resolve({ ok: false, error: marker, disposition: "not-acquired" });
      await bounded(app.completion);
    }
  });
}

test("a late close rejection updates completion without changing the settled stop result", async () => {
  const entered = deferred();
  const gate = deferred();
  const marker = new Error("late close");
  let closes = 0;
  const app = createApplication({
    shutdownTimeoutMs: 25,
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire({
            name: "same",
            open: () => ({ ok: true, value: 1 }),
            async close() {
              closes++;
              entered.resolve();
              await gate.promise;
              throw marker;
            },
          });
        },
      },
    ],
  });
  await app.start();
  const stopping = app.stop();
  try {
    await entered.promise;
    const result = await bounded(stopping);
    const oldErrors = [...result.snapshot.errors];
    assert.equal(result.timedOut, true);
    await pending(app.completion);
    gate.resolve();
    const done = await bounded(app.completion);
    assert.equal(done.successful, false);
    assert.equal(done.snapshot.cleanup, "failed");
    assert.ok(done.snapshot.errors.some((entry) => entry.error === marker));
    assert.deepEqual(result.snapshot.errors, oldErrors);
    assert.equal(result.snapshot.cleanup, "pending");
    assert.equal(closes, 1);
    assert.equal(app.stop(), stopping);
  } finally {
    gate.resolve();
    await bounded(app.completion);
  }
});

for (const disposition of ["not-acquired", "cleaned", "unknown", "raw"] as const) {
  test(`rejected open reports ${disposition} without inspecting opaque caller errors`, async () => {
    let inspected = 0;
    const marker = new Error();
    for (const key of ["message", "name", "cause", "code", "toString"]) {
      Object.defineProperty(marker, key, {
        configurable: true,
        get() {
          inspected++;
          throw new Error("opaque property read");
        },
      });
    }
    const cleanupMarker = Object.freeze({ cleanup: true });
    const events: string[] = [];
    const app = createApplication({
      providers: [
        {
          name: "backing",
          async setup(scope) {
            await scope.acquire(resource("backing", events));
          },
        },
        {
          name: "dependent",
          requires: ["backing"],
          async setup(scope) {
            await scope.acquire<string>({
              name: "partial",
              open() {
                if (disposition === "raw") throw marker;
                return {
                  ok: false,
                  error: marker,
                  disposition,
                  ...(disposition === "unknown" ? { cleanupErrors: [cleanupMarker] } : {}),
                };
              },
              close() {
                assert.fail("No handle was returned");
              },
            });
          },
        },
      ],
    });
    const failure = await rejected(app.start());
    const done = await bounded(app.completion);
    assert.equal(inspected, 0);
    assert.equal(Object.isFrozen(marker), false, "Owner froze caller-owned Error");
    assert.ok(done.snapshot.errors.some((entry) => entry.error === marker));
    if (disposition === "unknown") {
      assert.ok(done.snapshot.errors.some((entry) => entry.error === cleanupMarker));
      assert.ok(failure instanceof AggregateError);
      assert.equal(failure.cause, marker);
    } else assert.equal(failure, marker);
    const unknown = disposition === "unknown" || disposition === "raw";
    assert.equal(events.includes("backing.close"), !unknown);
    assert.equal(done.snapshot.cleanup, unknown ? "failed" : "clean");
    assert.equal(done.successful, !unknown);
    if (unknown) assert.ok(done.snapshot.retainedResources.length > 0);
    assert.equal(inspected, 0);
  });
}

test("new acquire after cancellation is rejected before its factory can run", async () => {
  const entered = deferred();
  const gate = deferred();
  let forbidden = 0;
  const app = createApplication({
    shutdownTimeoutMs: 25,
    providers: [
      {
        name: "same",
        async setup(scope) {
          entered.resolve();
          await gate.promise;
          await scope.acquire({
            name: "too-late",
            open() {
              forbidden++;
              return { ok: true, value: 1 };
            },
            close() {},
          });
        },
      },
    ],
  });
  const startup = app.start();
  await entered.promise;
  const stop = app.stop();
  gate.resolve();
  await rejected(startup);
  await bounded(stop);
  await bounded(app.completion);
  assert.equal(forbidden, 0);
});

test("failed-start cleanup budget is independent from the ordinary stop budget", async () => {
  const gate = deferred();
  const entered = deferred();
  const primary = new Error("startup");
  const app = createApplication({
    shutdownTimeoutMs: 1000,
    startupCleanupTimeoutMs: 25,
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire({
            name: "same",
            open: () => ({ ok: true, value: 1 }),
            async close() {
              entered.resolve();
              await gate.promise;
            },
          });
          throw primary;
        },
      },
    ],
  });
  const start = app.start();
  try {
    await entered.promise;
    assert.equal(await bounded(rejected(start), "failed startup budget", 600), primary);
    const result = await bounded(app.stop(), "failed startup stop budget", 600);
    assert.equal(result.timedOut, true);
    await pending(app.completion);
  } finally {
    gate.resolve();
    assert.equal((await bounded(app.completion)).snapshot.cleanup, "clean");
  }
});

for (const lateDrain of ["success", "failure"] as const) {
  test(`timed-out drain waits for actual late ${lateDrain} before deciding infrastructure cleanup`, async () => {
    const entered = deferred();
    const gate = deferred();
    const marker = new Error("drain not confirmed");
    const events: string[] = [];
    const app = createApplication({
      shutdownTimeoutMs: 25,
      providers: [
        {
          name: "same",
          async setup(scope) {
            await scope.acquire(
              resource("same", events, {
                async drain() {
                  events.push("same.drain");
                  entered.resolve();
                  await gate.promise;
                  if (lateDrain === "failure") throw marker;
                },
              }),
            );
          },
        },
      ],
    });
    await app.start();
    const stopping = app.stop();
    try {
      await bounded(entered.promise);
      const stop = await bounded(stopping);
      assert.equal(stop.timedOut, true);
      assert.equal(events.includes("same.flush"), false);
      assert.equal(events.includes("same.close"), false);
      await pending(app.completion);
      gate.resolve();
      const done = await bounded(app.completion);
      assert.equal(done.snapshot.cleanup, lateDrain === "success" ? "clean" : "failed");
      assert.equal(events.includes("same.flush"), lateDrain === "success");
      assert.equal(events.includes("same.close"), lateDrain === "success");
      if (lateDrain === "failure")
        assert.ok(done.snapshot.errors.some((entry) => entry.error === marker));
      assert.equal(stop.snapshot.cleanup, "pending");
    } finally {
      gate.resolve();
      await bounded(app.completion);
    }
  });
}

test("malformed or accessor open outcomes settle unknown rather than abandoning acquisition", async () => {
  const marker = new Error("outcome accessor");
  const accessor = Object.defineProperty({}, "ok", {
    get() {
      throw marker;
    },
  });
  const outcomes: unknown[] = [
    null,
    undefined,
    {},
    { ok: "yes" },
    { ok: true },
    { ok: false, error: marker, disposition: "unrecognized" },
    { ok: false, error: marker, disposition: "cleaned", cleanupErrors: "not an array" },
    accessor,
  ];
  for (const outcome of outcomes) {
    const events: string[] = [];
    const app = createApplication({
      providers: [
        {
          name: "backing",
          async setup(scope) {
            await scope.acquire(resource("backing", events));
          },
        },
        {
          name: "dependent",
          requires: ["backing"],
          async setup(scope) {
            await scope.acquire({
              name: "malformed",
              open: () => outcome as OpenOutcome<string>,
              close() {
                assert.fail("Malformed outcome returned a resource");
              },
            });
          },
        },
      ],
    });
    await rejected(app.start());
    const done = await bounded(app.completion);
    assert.equal(done.snapshot.cleanup, "failed");
    assert.equal(done.successful, false);
    assert.equal(
      done.snapshot.pendingAcquisitions.length,
      0,
      "Settled malformed outcome left an in-flight acquisition",
    );
    assert.ok(done.snapshot.retainedResources.length > 0);
    assert.equal(events.includes("backing.close"), false);
  }
});

test("resource spec accessors are rejected before open can acquire anything", async () => {
  let openCalls = 0;
  let accessorCalls = 0;
  const spec = Object.defineProperty(
    {
      name: "same",
      open() {
        openCalls++;
        return { ok: true as const, value: 1 };
      },
    },
    "close",
    {
      get() {
        accessorCalls++;
        throw new Error("spec accessor");
      },
    },
  );
  const app = createApplication({
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire(spec as unknown as ResourceSpec<number>);
        },
      },
    ],
  });
  await rejected(app.start());
  const done = await bounded(app.completion);
  assert.equal(openCalls, 0);
  assert.equal(accessorCalls, 0);
  assert.equal(done.snapshot.pendingAcquisitions.length, 0);
  assert.equal(done.snapshot.cleanup, "clean");
});

test("invalid resource declarations reject before acquisition effects", async () => {
  let effects = 0;
  const base = {
    name: "same",
    open() {
      effects++;
      return { ok: true as const, value: 1 };
    },
    close() {},
  };
  const inheritedStop = Object.assign(
    Object.create({
      stop() {
        effects++;
      },
    }),
    base,
  );
  const invalid: unknown[] = [
    null,
    {},
    { ...base, name: "" },
    { ...base, name: 1 },
    { ...base, open: null },
    { ...base, close: null },
    inheritedStop,
    ...["stop", "drain", "flush"].map((phase) => ({ ...base, [phase]: "not callable" })),
  ];
  for (const spec of invalid) {
    const app = createApplication({
      providers: [
        {
          name: "same",
          async setup(scope) {
            await scope.acquire(spec as ResourceSpec<number>);
          },
        },
      ],
    });
    await rejected(app.start());
    const done = await bounded(app.completion);
    assert.equal(done.snapshot.cleanup, "clean");
    assert.equal(done.snapshot.pendingAcquisitions.length, 0);
  }
  assert.equal(effects, 0);
});
