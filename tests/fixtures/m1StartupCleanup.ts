/** Actual M1 startup acceptance; unsafe ownership is isolated by process exit. */
import assert from "node:assert/strict";
import { collectProviders, createAppContext } from "@getstrata/bootstrap/context";
import * as m1 from "@getstrata/bootstrap/m1";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import {
  clearActiveApplicationContext,
  resolveApplicationConfig,
  resolveApplicationDependencies,
  setActiveApplicationContext,
} from "@getstrata/core/runtime/applicationRegistry";

export const modes = [
  "invalid-budgets",
  "accessor-unknown-errors",
  "timely-success",
  "default-budget",
  "timely-drain-failure",
  "timely-flush-failure",
  "timely-close-failure",
  "deadline-late-success",
  "deadline-never-drain",
  "deadline-late-drain-rejection",
  "deadline-late-flush-rejection",
  "deadline-late-close-rejection",
  "deadline-close-pending",
  "deadline-metadata-conflict",
  "deadline-foreign-context",
  "deadline-stop-pending",
  "stop-rejection-admitted-request",
  "ignored-timely-failure",
  "ignored-late-rejection",
  "ordinary-shutdown-budget-separate",
  "unknown-provider-acquisition",
] as const;
type Mode = (typeof modes)[number];
const base = () =>
  collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"pending">((resolve) => {
        timer = setTimeout(() => resolve("pending"), 200);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function includesError(error: unknown, expected: unknown): boolean {
  return (
    error === expected ||
    (error instanceof AggregateError && error.errors.some((item) => includesError(item, expected)))
  );
}

export async function runStartupCleanup(mode: Mode) {
  const completion = (failure: unknown) => {
    assert.equal(typeof m1.getM1StartupCleanupCompletion, "function");
    return m1.getM1StartupCleanupCompletion(failure);
  };
  assert.ok(modes.includes(mode));
  if (mode === "accessor-unknown-errors") {
    let reads = 0;
    const unknown = Object.defineProperties(
      {},
      {
        completion: {
          get() {
            reads++;
            throw new Error("private");
          },
        },
        message: {
          get() {
            reads++;
            throw new Error("private");
          },
        },
      },
    );
    const proxy = new Proxy(
      {},
      {
        get() {
          reads++;
          throw new Error("private");
        },
      },
    );
    for (const value of [
      undefined,
      null,
      1,
      "private",
      Symbol("private"),
      unknown,
      proxy,
      () => {},
    ])
      assert.equal(completion(value), undefined);
    assert.equal(reads, 0);
    return { mode, accepted: true };
  }
  if (mode === "invalid-budgets") {
    for (const budget of [0, -1, 0.5, NaN, Infinity, 2147483648, null, false, "20"]) {
      let acquired = 0;
      let app: Awaited<ReturnType<typeof m1.startGuardedApplication>> | undefined;
      let failure: unknown;
      try {
        const options: m1.M1ApplicationOptions = {
          startupCleanupTimeoutMs: budget as number,
          providers: [
            ...base(),
            {
              name: "untouched",
              register() {
                acquired++;
              },
            },
          ],
          modules: [],
        };
        try {
          app = await m1.startGuardedApplication(options);
        } catch (error) {
          failure = error;
        }
      } finally {
        await app?.shutdown();
      }
      assert.ok(failure instanceof Error, "Invalid budget must reject before acquisition.");
      assert.equal(acquired, 0);
      assert.deepEqual(m1.describeM1Failure(failure), {
        stage: "validation",
        code: "invalid-cleanup-timeout",
        field: "startupCleanupTimeoutMs",
      });
      const retry = await m1.startGuardedApplication({ providers: base(), modules: [] });
      assert.equal((await retry.shutdown()).successful, true);
    }
    for (const budget of [1, 2147483647]) {
      const options: m1.M1ApplicationOptions = {
        providers: base(),
        modules: [],
        startupCleanupTimeoutMs: budget,
      };
      const app = await m1.startGuardedApplication(options);
      assert.equal((await app.shutdown()).successful, true);
    }
    return { mode, accepted: true };
  }

  const primary = new Error("owned-startup-primary");
  const secondary = new Error("owned-cleanup-secondary");
  const stopFailure = new Error("owned-admission-stop-failure");
  const gate = deferred();
  const stopGate = deferred();
  const requestGate = deferred();
  const requestEntered = deferred();
  const drainSettled = deferred();
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", onUnhandled);
  let drains = 0,
    flushes = 0,
    closes = 0,
    stopCalls = 0,
    foreignCloses = 0;
  let completionReads = 0;
  let resource: ReturnType<typeof Bun.serve> | undefined;
  let mainServer: ReturnType<typeof Bun.serve> | undefined;
  let nativeStop: ((force?: boolean) => Promise<void>) | undefined;
  let heldResponse: Promise<Response> | undefined;
  let dependencies: unknown;
  let neverVerified = false;
  let starting: Promise<unknown> | undefined;
  let foreign: Awaited<ReturnType<typeof createAppContext>> | undefined;
  const serve = Bun.serve;
  const register = LifecycleCoordinator.prototype.register;
  const set = globalThis.setTimeout;
  const clear = globalThis.clearTimeout;
  const oldShutdownBudget = process.env.SHUTDOWN_TIMEOUT_MS;
  process.env.SHUTDOWN_TIMEOUT_MS = mode === "ordinary-shutdown-budget-separate" ? "20" : "1000";
  const isDeadline = mode.startsWith("deadline-") || mode === "ignored-late-rejection";
  const budget =
    mode === "default-budget"
      ? undefined
      : mode === "ordinary-shutdown-budget-separate"
        ? 250
        : isDeadline
          ? 20
          : 1000;
  const expectedBudget = budget ?? 30_000;
  const createdTimers = new Set<ReturnType<typeof setTimeout>>();
  const clearedTimers = new Set<ReturnType<typeof setTimeout>>();
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timer = set(...args);
    if (args[1] === expectedBudget) createdTimers.add(timer);
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: Parameters<typeof clearTimeout>[0]) => {
    if (createdTimers.has(timer as ReturnType<typeof setTimeout>))
      clearedTimers.add(timer as ReturnType<typeof setTimeout>);
    return clear(timer);
  }) as typeof clearTimeout;
  const failDrain = [
    "timely-drain-failure",
    "deadline-late-drain-rejection",
    "ignored-late-rejection",
  ].includes(mode);
  const failFlush = ["timely-flush-failure", "deadline-late-flush-rejection"].includes(mode);
  const failClose = [
    "timely-close-failure",
    "deadline-late-close-rejection",
    "ignored-timely-failure",
  ].includes(mode);
  const heldPhase =
    mode === "deadline-late-flush-rejection"
      ? "flush"
      : mode === "deadline-close-pending"
        ? "close"
        : mode === "ordinary-shutdown-budget-separate" ||
            (isDeadline && mode !== "deadline-stop-pending")
          ? "drain"
          : undefined;
  const postBind = isDeadline || mode === "stop-rejection-admitted-request";
  const getCompletion = (failure: unknown) => {
    completionReads++;
    return completion(failure);
  };
  const retryBlocked = () =>
    assert.rejects(
      m1.startGuardedApplication({ providers: base(), modules: [] }),
      /already active/,
    );
  try {
    if (mode === "deadline-foreign-context") {
      foreign = await createAppContext([
        ...base(),
        {
          name: "foreign",
          register({ onCleanup }) {
            onCleanup(() => {
              foreignCloses++;
            });
          },
        },
      ]);
      clearActiveApplicationContext(foreign);
    }
    routeRegistry.register({ method: "GET", path: "/before-cleanup", middleware: [] });
    const before = routeRegistry.list();
    if (mode === "unknown-provider-acquisition") {
      const options: m1.M1ApplicationOptions = {
        startupCleanupTimeoutMs: 20,
        providers: [
          ...base(),
          {
            name: "acquiring",
            async register({ onCleanup }) {
              onCleanup(() => {
                closes++;
              });
              await gate.promise;
              throw primary;
            },
          },
        ],
        modules: [],
      };
      starting = m1.startGuardedApplication(options);
      const observed = starting.then(
        () => "resolved",
        (error) => error,
      );
      await Bun.sleep(60);
      assert.equal(await Promise.race([observed, Promise.resolve("pending")]), "pending");
      await retryBlocked();
      gate.resolve();
      assert.equal(await observed, primary);
      assert.equal(completion(primary), undefined);
      assert.equal(closes, 1);
      await retryBlocked();
      return { mode, accepted: true };
    }
    Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
      const server = serve(options);
      if (Object.hasOwn(options, "routes")) {
        mainServer = server;
        nativeStop = server.stop.bind(server);
        server.stop = async (force) => {
          stopCalls++;
          if (mode === "stop-rejection-admitted-request") {
            heldResponse = fetch(new URL("/held", server.url));
            await requestEntered.promise;
            throw stopFailure;
          }
          if (mode === "deadline-stop-pending") await stopGate.promise;
          return nativeStop?.(force);
        };
      }
      return server;
    }) as typeof Bun.serve;
    if (postBind)
      LifecycleCoordinator.prototype.register = function (name, handler, phase) {
        if (name === "m1:providers:drain") throw primary;
        return register.call(this, name, handler, phase);
      };
    const options: m1.M1ApplicationOptions = {
      startupCleanupTimeoutMs: budget,
      providers: [
        ...base(),
        {
          name: "owned",
          register({ onCleanup, dependencies: owned }) {
            dependencies = owned;
            resource = Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: () => new Response("provider-live"),
            });
            onCleanup(async () => {
              drains++;
              try {
                if (heldPhase === "drain") await gate.promise;
                if (failDrain) throw secondary;
              } finally {
                drainSettled.resolve();
              }
            }, "drain");
            onCleanup(async () => {
              flushes++;
              if (heldPhase === "flush") await gate.promise;
              if (failFlush) throw secondary;
            }, "flush");
            onCleanup(async () => {
              closes++;
              if (heldPhase === "close") await gate.promise;
              await resource?.stop(true);
              if (failClose) throw secondary;
            });
          },
        },
      ],
      modules: [
        {
          name: "owned",
          routes() {
            if (!postBind) throw primary;
            return {
              "/candidate": () => new Response("candidate"),
              "/held": async () => {
                requestEntered.resolve();
                await requestGate.promise;
                return Response.json({ providerLive: closes === 0 });
              },
            };
          },
        },
      ],
    };
    starting = m1.startGuardedApplication(options);
    const observed = starting.then(
      (app) => ({ kind: "resolved" as const, app }),
      (failure) => ({ kind: "rejected" as const, failure }),
    );
    if (mode === "ordinary-shutdown-budget-separate") {
      await Bun.sleep(60);
      assert.equal(await Promise.race([observed, Promise.resolve("pending")]), "pending");
      assert.equal(closes, 0);
      gate.resolve();
    }
    const observedResult = await bounded(observed);
    assert.notEqual(observedResult, "pending", "Startup cleanup must bound the caller's wait.");
    assert.ok(observedResult !== "pending" && observedResult.kind === "rejected");
    const failure = observedResult.failure;
    const diagnostic = m1.describeM1Failure(failure);
    LifecycleCoordinator.prototype.register = register;
    Bun.serve = serve;
    if (isDeadline) {
      assert.ok(failure instanceof AggregateError);
      assert.equal(failure.cause, primary);
      assert.equal(failure.errors[0], primary);
      assert.deepEqual(diagnostic, {
        stage: "cleanup",
        code: "startup-cleanup-timed-out",
        field: "application",
        owner: "application",
      });
      assert.equal(closes, heldPhase === "close" ? 1 : 0);
      if (heldPhase !== "close") assert.equal(resolveApplicationDependencies(), dependencies);
      assert.ok(resource);
      assert.equal(await (await fetch(resource.url)).text(), "provider-live");
      await retryBlocked();
      const initialErrors = [...failure.errors];
      if (mode === "ignored-late-rejection") {
        gate.resolve();
        await drainSettled.promise;
        await Bun.sleep(20);
        assert.equal(completionReads, 0);
        assert.equal(closes, 0);
        assert.equal(flushes, 0);
        assert.deepEqual(failure.errors, initialErrors);
        assert.equal(m1.describeM1Failure(failure), diagnostic);
        await retryBlocked();
      } else {
        const handle = getCompletion(failure);
        assert.ok(handle);
        assert.equal(getCompletion(failure), handle);
        let settled = false;
        void handle.then(() => {
          settled = true;
        });
        await Bun.sleep(1);
        assert.equal(settled, false);
        if (mode === "deadline-never-drain") {
          await Bun.sleep(25);
          assert.equal(settled, false);
          assert.equal(closes, 0);
          assert.equal(flushes, 0);
          neverVerified = true;
        } else {
          if (mode === "deadline-metadata-conflict")
            routeRegistry.register({ method: "GET", path: "/foreign-cleanup", middleware: [] });
          if (foreign) setActiveApplicationContext(foreign);
          if (mode === "deadline-stop-pending") {
            assert.equal(drains, 0);
            assert.equal(flushes, 0);
            assert.ok(mainServer);
            assert.equal(
              await (await fetch(new URL("/candidate", mainServer.url))).text(),
              "candidate",
            );
            stopGate.resolve();
          } else gate.resolve();
          const outcome = await handle;
          assert.equal(await handle, outcome);
          assert.equal(await getCompletion(failure), outcome);
          assert.equal(Object.isFrozen(outcome), true);
          assert.equal(Object.isFrozen(outcome.errors), true);
          assert.deepEqual(failure.errors, initialErrors);
          assert.equal(failure.cause, primary);
          assert.equal(m1.describeM1Failure(failure), diagnostic);
          if (failDrain || failFlush || failClose) {
            assert.equal(outcome.state, "cleanup-failed");
            assert.equal(outcome.startupReservationReleased, false);
            assert.ok(outcome.errors.some((error) => includesError(error, secondary)));
            assert.equal(closes, failDrain ? 0 : 1);
            assert.equal(flushes, failDrain ? 0 : 1);
            await retryBlocked();
          } else if (mode === "deadline-metadata-conflict") {
            assert.equal(outcome.state, "metadata-conflict");
            assert.equal(outcome.startupReservationReleased, false);
            assert.equal(outcome.errors.length, 1);
            assert.ok(routeRegistry.list().some((row) => row.path === "/foreign-cleanup"));
            assert.ok(!routeRegistry.list().some((row) => row.path === "/before-cleanup"));
            await retryBlocked();
          } else {
            assert.equal(outcome.state, "cleaned");
            assert.equal(outcome.startupReservationReleased, true);
            assert.deepEqual(outcome.errors, []);
            assert.equal(closes, 1);
            assert.equal(flushes, 1);
            assert.deepEqual(routeRegistry.list(), before);
            if (foreign) {
              assert.equal(resolveApplicationConfig(), foreign.config);
              assert.equal(foreignCloses, 0);
              await retryBlocked();
              await foreign.dispose();
              assert.equal(foreignCloses, 1);
            }
            globalThis.setTimeout = set;
            globalThis.clearTimeout = clear;
            const retry = await m1.startGuardedApplication({ providers: base(), modules: [] });
            assert.equal((await retry.shutdown()).successful, true);
          }
        }
      }
    } else if (mode === "stop-rejection-admitted-request") {
      assert.ok(failure instanceof AggregateError);
      assert.equal(failure.cause, primary);
      assert.ok(failure.errors.includes(stopFailure));
      assert.equal(stopCalls, 1);
      assert.equal(closes, 0, "Unconfirmed admission stop must not close infrastructure.");
      assert.equal(drains, 0);
      assert.ok(resource);
      assert.equal(await (await fetch(resource.url)).text(), "provider-live");
      const handle = getCompletion(failure);
      assert.ok(handle);
      const outcome = await handle;
      assert.equal(outcome.state, "cleanup-failed");
      assert.equal(outcome.startupReservationReleased, false);
      assert.ok(outcome.errors.includes(stopFailure));
      requestGate.resolve();
      assert.ok(heldResponse);
      assert.deepEqual(await (await heldResponse).json(), { providerLive: true });
      await retryBlocked();
    } else if (failDrain || failFlush || failClose) {
      assert.ok(failure instanceof AggregateError);
      assert.equal(failure.cause, primary);
      assert.ok(includesError(failure, secondary));
      if (mode !== "ignored-timely-failure") {
        const handle = getCompletion(failure);
        assert.ok(handle);
        assert.equal(getCompletion(failure), handle);
        const outcome = await handle;
        assert.equal(await handle, outcome);
        assert.equal(outcome.state, "cleanup-failed");
        assert.equal(outcome.startupReservationReleased, false);
        assert.ok(outcome.errors.some((error) => includesError(error, secondary)));
        assert.equal(Object.isFrozen(outcome), true);
        assert.equal(Object.isFrozen(outcome.errors), true);
      }
      assert.equal(closes, failDrain ? 0 : 1);
      assert.equal(flushes, failDrain ? 0 : 1);
      assert.equal(createdTimers.size, 1);
      assert.equal(clearedTimers.size, 1);
      await retryBlocked();
    } else {
      assert.equal(failure, primary);
      assert.equal(getCompletion(failure), undefined);
      assert.equal(createdTimers.size, 1);
      assert.equal(clearedTimers.size, 1);
      assert.equal(drains, 1);
      assert.equal(flushes, 1);
      assert.equal(closes, 1);
      assert.deepEqual(routeRegistry.list(), before);
      globalThis.setTimeout = set;
      globalThis.clearTimeout = clear;
      const retry = await m1.startGuardedApplication({ providers: base(), modules: [] });
      assert.equal((await retry.shutdown()).successful, true);
    }
    if (mode !== "deadline-never-drain" && mode !== "deadline-close-pending")
      assert.ok(drains <= 1);
    if (mode === "ignored-timely-failure") assert.equal(completionReads, 0);
    await Bun.sleep(1);
    assert.deepEqual(unhandled, []);
    return {
      mode,
      accepted: true,
      drains,
      flushes,
      closes,
      completionReads,
      noUnhandledRejection: true,
    };
  } finally {
    LifecycleCoordinator.prototype.register = register;
    Bun.serve = serve;
    globalThis.setTimeout = set;
    globalThis.clearTimeout = clear;
    if (!neverVerified) gate.resolve();
    stopGate.resolve();
    requestGate.resolve();
    await heldResponse?.catch(() => {});
    await nativeStop?.(true);
    await resource?.stop(true);
    await foreign?.dispose();
    process.off("unhandledRejection", onUnhandled);
    if (oldShutdownBudget === undefined) delete process.env.SHUTDOWN_TIMEOUT_MS;
    else process.env.SHUTDOWN_TIMEOUT_MS = oldShutdownBudget;
    if (!neverVerified) await starting?.catch(() => {});
  }
}
if (import.meta.main) console.log(JSON.stringify(await runStartupCleanup(process.argv[2] as Mode)));
