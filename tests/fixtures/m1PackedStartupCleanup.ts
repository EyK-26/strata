/** Copied unchanged into an app installed from candidate tarballs; public imports only. */
import assert from "node:assert/strict";
import { appContext, collectProviders } from "@getstrata/bootstrap/context";
import {
  describeM1Failure,
  getM1StartupCleanupCompletion,
  startGuardedApplication,
} from "@getstrata/bootstrap/m1";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";

const mode = process.argv[2];
assert.ok(
  [
    "timely-failure",
    "late-success",
    "ignored-late-failure",
    "metadata-conflict",
    "never-settling",
  ].includes(mode ?? ""),
);
const providers = collectProviders([]).filter((provider) =>
  ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(provider.name),
);
let release!: () => void, drainFinished!: () => void;
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
const drained = new Promise<void>((resolve) => {
  drainFinished = resolve;
});
const primary = new Error("owned-packed-startup-primary");
const secondary = new Error("owned-packed-cleanup-secondary");
let closes = 0,
  drains = 0,
  completionReads = 0;
let container: unknown;
let starting: Promise<unknown> | undefined;
let neverVerified = false;
const register = LifecycleCoordinator.prototype.register;
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => {
  unhandled.push(error);
};
process.on("unhandledRejection", onUnhandled);
routeRegistry.register({ method: "GET", path: "/before-packed-cleanup", middleware: [] });
const before = routeRegistry.list();
if (mode !== "timely-failure")
  LifecycleCoordinator.prototype.register = function (name, handler, phase) {
    if (name === "m1:providers:drain") throw primary;
    return register.call(this, name, handler, phase);
  };
const getCompletion = (error: unknown) => {
  completionReads++;
  return getM1StartupCleanupCompletion(error);
};
try {
  starting = startGuardedApplication({
    startupCleanupTimeoutMs: mode === "timely-failure" ? 1000 : 20,
    providers: [
      ...providers,
      {
        name: "owned",
        register({ onCleanup, container: owner }) {
          container = owner;
          onCleanup(async () => {
            drains++;
            try {
              if (mode !== "timely-failure") await gate;
              if (mode === "ignored-late-failure") throw secondary;
            } finally {
              drainFinished();
            }
          }, "drain");
          onCleanup(() => {
            closes++;
            if (mode === "timely-failure") throw secondary;
          });
        },
      },
    ],
    modules: [
      {
        name: "packed",
        routes() {
          if (mode === "timely-failure") throw primary;
          return { "/packed": () => new Response("candidate") };
        },
      },
    ],
  });
  const observed = starting.then(
    () => ({ kind: "resolved" as const }),
    (failure) => ({ kind: "rejected" as const, failure }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: Awaited<typeof observed> | "pending";
  try {
    result = await Promise.race([
      observed,
      new Promise<"pending">((resolve) => {
        timer = setTimeout(() => resolve("pending"), 250);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.notEqual(result, "pending", "Installed public startup must use the cleanup wait budget.");
  assert.ok(result !== "pending" && result.kind === "rejected");
  const failure = result.failure;
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.cause, primary);
  const diagnostic = describeM1Failure(failure);
  assert.equal(diagnostic.stage, "cleanup");
  assert.equal(
    diagnostic.code,
    mode === "timely-failure" ? "startup-cleanup-failed" : "startup-cleanup-timed-out",
  );
  LifecycleCoordinator.prototype.register = register;
  if (mode !== "timely-failure") {
    assert.equal(closes, 0);
    assert.equal(
      appContext.container,
      container,
      "Packed failure must retain the public context owner while draining.",
    );
    await assert.rejects(startGuardedApplication({ providers, modules: [] }), /already active/);
  }
  if (mode === "ignored-late-failure") {
    release();
    await drained;
    await Bun.sleep(20);
    assert.equal(completionReads, 0);
    assert.equal(closes, 0);
    await assert.rejects(startGuardedApplication({ providers, modules: [] }), /already active/);
  } else {
    const completion = getCompletion(failure);
    assert.ok(completion, "Installed accessor must share the startup observer's completion map.");
    assert.equal(getCompletion(failure), completion);
    if (mode === "never-settling") {
      let settled = false;
      void completion.then(() => {
        settled = true;
      });
      await Bun.sleep(25);
      assert.equal(settled, false);
      assert.equal(closes, 0);
      neverVerified = true;
    } else {
      if (mode === "metadata-conflict")
        routeRegistry.register({ method: "GET", path: "/foreign-packed", middleware: [] });
      release();
      const outcome = await completion;
      assert.equal(await getCompletion(failure), outcome);
      assert.equal(Object.isFrozen(outcome), true);
      assert.equal(Object.isFrozen(outcome.errors), true);
      if (mode === "timely-failure") {
        assert.equal(outcome.state, "cleanup-failed");
        assert.equal(outcome.startupReservationReleased, false);
        assert.equal(closes, 1);
        assert.throws(() => appContext.container, /not ready/);
        await assert.rejects(startGuardedApplication({ providers, modules: [] }), /already active/);
      } else if (mode === "metadata-conflict") {
        assert.equal(outcome.state, "metadata-conflict");
        assert.equal(outcome.startupReservationReleased, false);
        assert.ok(routeRegistry.list().some((row) => row.path === "/foreign-packed"));
        assert.throws(() => appContext.container, /not ready/);
        await assert.rejects(startGuardedApplication({ providers, modules: [] }), /already active/);
      } else {
        assert.equal(outcome.state, "cleaned");
        assert.equal(outcome.startupReservationReleased, true);
        assert.equal(closes, 1);
        assert.deepEqual(routeRegistry.list(), before);
        assert.throws(() => appContext.container, /not ready/);
        const retry = await startGuardedApplication({ providers, modules: [] });
        assert.equal(appContext.container, retry.context.container);
        assert.equal((await retry.shutdown()).successful, true);
      }
    }
  }
  assert.equal(drains, 1);
  assert.equal(failure.cause, primary);
  assert.equal(describeM1Failure(failure), diagnostic);
  await Bun.sleep(1);
  assert.deepEqual(unhandled, []);
  console.log(JSON.stringify({ mode, passed: true, publicEntry: true, completionReads, closes }));
} finally {
  LifecycleCoordinator.prototype.register = register;
  if (!neverVerified) release();
  if (!neverVerified) await starting?.catch(() => {});
  process.off("unhandledRejection", onUnhandled);
}
