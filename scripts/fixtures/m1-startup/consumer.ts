import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { compileRouteMap, getRouteInventory } from "@getstrata/bootstrap/routePlan";
import { type Attempt, attempts, begin, captureOwner } from "./state.ts";
import type { ProbeCase } from "./types.ts";

const input = process.argv[2];
const output = process.argv[3];
assert.ok(input && output);
const spec: ProbeCase = await Bun.file(input).json();
const report: Record<string, unknown> = { mode: spec.mode, classification: spec.classification };
const unknownNativeAcquisition = spec.mode === "native-bad-pattern";
function active(attempt: Attempt): boolean {
  assert.ok(attempt.owner, "Startup probe must capture the original application owner");
  return attempt.owner.state.phase === "ready";
}
async function assertClosedAdmission(attempt: Attempt) {
  assert.ok(attempt.owner);
  let admitted = false;
  await assert.rejects(
    attempt.owner.run(() => {
      admitted = true;
    }),
  );
  assert.equal(admitted, false, "Stopped application must reject late business work");
}
function leaves(error: unknown, seen = new Set<unknown>()): Error[] {
  if (!(error instanceof Error) || seen.has(error)) return [];
  seen.add(error);
  return [
    error,
    ...(error instanceof AggregateError ? error.errors.flatMap((e) => leaves(e, seen)) : []),
    ...leaves(error.cause, seen),
  ];
}
function describe(error: unknown) {
  return leaves(error).map((e) => ({
    name: e.name,
    message: e.message,
    code: Reflect.get(e, "code") ?? null,
  }));
}
async function released(a: Attempt, expectClosed: boolean) {
  for (const resource of a.resources) {
    if (expectClosed) {
      assert.equal(resource.closed, 1);
      const witness = Bun.serve({
        hostname: "127.0.0.1",
        port: resource.port,
        fetch: () => new Response("owned-rebind"),
      });
      await witness.stop(true);
    } else {
      assert.equal(resource.closed, 0);
      assert.equal(
        await (
          await fetch(`http://127.0.0.1:${resource.port}`, { signal: AbortSignal.timeout(2000) })
        ).text(),
        `owned-${resource.label}`,
      );
    }
  }
}
function snapshot(a: Attempt) {
  return {
    mode: a.mode,
    events: a.events,
    factoryCalls: a.factoryCalls,
    handlers: a.handlers,
    getters: a.getters,
    traps: a.traps,
    resources: a.resources.map((v) => ({ label: v.label, closedByProvider: v.closed })),
  };
}
let server: ReturnType<typeof Bun.serve> | undefined;
let occupier: ReturnType<typeof Bun.serve> | undefined;
let context: { dispose(): Promise<void> } | undefined;
let failure: unknown;
try {
  const first = begin(spec.mode);
  if (spec.mode.startsWith("native-bind")) {
    occupier = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("owned-occupier"),
    });
    assert.ok(occupier.port);
    process.env.PORT = String(occupier.port);
    process.env.HOST = "127.0.0.1";
  }
  type Bootstrapped = {
    application: import("@getstrata/core/contracts/application").Application;
    context: { dispose(): Promise<void>; drain(): Promise<void> };
    server?: ReturnType<typeof Bun.serve>;
    routes: Record<string, unknown>;
  };
  type Options = {
    migrate: false;
    onConstructed: typeof captureOwner;
    server?: { port: number; native: { hostname: string } };
  };
  const api: {
    createApp(options: Options): Promise<Bootstrapped>;
    createAppServer(options: Options): Promise<Bootstrapped>;
  } = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
  const options: Options = {
    migrate: false,
    onConstructed: captureOwner,
    server: { port: 0, native: { hostname: "127.0.0.1" } },
  };
  const previousRoutes = compileRouteMap({ "/previous-snapshot": { GET: () => new Response() } });
  report.registryBefore = getRouteInventory(previousRoutes);
  let error: unknown;
  const callerCleanup = false;
  if (spec.mode.startsWith("native-bind")) {
    try {
      await import(new URL("../bootstrap/server.ts", import.meta.url).href);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, "The occupied generated entrypoint must reject.");
    const errors = leaves(error);
    report.nativeBindFailureRetained = errors.some((e) => Reflect.get(e, "code") === "EADDRINUSE");
    assert.ok(errors.some((value) => Reflect.get(value, "code") === "EADDRINUSE"));
    if (spec.mode === "native-bind-close-failure") {
      assert.ok(
        errors.includes(first.cleanupError),
        "The original provider B cleanup exception remains inspectable",
      );
      assert.deepEqual(
        first.events.filter((event) => event.endsWith(".close")),
        ["B.close", "A.close"],
      );
    }
  } else {
    try {
      const app =
        spec.mode === "drain-failure"
          ? await api.createApp(options)
          : await api.createAppServer(options);
      context = app.context;
      assert.equal(first.owner, app.application);
      assert.equal(app.application.state.phase, "ready");
      assert.equal(first.handlers, 0, "Bootstrap must not invoke fixture business handlers.");
      report.ownerReadyAfterStartup = active(first);
      await app.application.run(() => {
        report.readyOwnerAdmitsExecution = true;
      });
      if (spec.mode === "drain-failure") {
        await app.context.drain();
      } else {
        server = app.server;
        assert.ok(server?.port);
        const response = await fetch(new URL("/startup-probe", server.url));
        report.firstHttp = { status: response.status, body: await response.text() };
        assert.equal(response.status, spec.mode === "late-handler-failure" ? 500 : 200);
        assert.equal(first.handlers, 1);
      }
      await Promise.all([context.dispose(), context.dispose()]);
      server = undefined;
      context = undefined;
    } catch (caught) {
      error = caught;
      if (spec.mode === "native-bad-pattern") {
        report.ownerReadyAfterConstructorFailure = active(first);
        report.listenerFailureCleanup = "unknown-acquisition-retained";
      }
    }
  }
  assert.ok(first.owner, "Every startup attempt must expose its actual original owner");
  const originalStartupError = error;
  const ownerErrors = first.owner.state.errors.map((diagnostic) => diagnostic.error);
  if (ownerErrors.length)
    error = new AggregateError(
      [error, ...ownerErrors].filter(Boolean),
      "Observed startup and owner diagnostics",
      { cause: error },
    );
  report.owner = {
    ...first.owner.state,
    errors: first.owner.state.errors.map(({ error, ...diagnostic }) => ({
      ...diagnostic,
      errors: describe(error),
    })),
  };
  report.fixtureStartupMarkerRetained = leaves(error).includes(first.startupError);
  report.errors = describe(error);
  report.registryAfter = getRouteInventory(previousRoutes);
  report.callerCleanupAfterTransportRejection = callerCleanup;
  assert.equal(first.factoryCalls, spec.expectedFactoryCalls);
  if (
    [
      "register-failure",
      "boot-failure",
      "close-failure",
      "flush-failure",
      "route-factory-failure",
      "route-getter",
      "route-proxy",
      "startup-drain-failure",
    ].includes(spec.mode)
  )
    assert.ok(leaves(error).includes(first.startupError));
  if (["close-failure", "flush-failure"].includes(spec.mode))
    assert.ok(leaves(error).includes(first.cleanupError));
  if (spec.mode === "dependency-missing")
    assert.ok(leaves(error).some((value) => /dependency "cache"/.test(value.message)));
  if (spec.mode === "orphan-metadata")
    assert.ok(leaves(error).some((value) => /no API route/.test(value.message)));
  const drainFailed = ["drain-failure", "startup-drain-failure"].includes(spec.mode);
  if (spec.mode.startsWith("native-bind")) {
    const nativeError = leaves(originalStartupError).find(
      (value) => Reflect.get(value, "code") === "EADDRINUSE",
    );
    assert.ok(nativeError);
    assert.ok(
      ownerErrors.includes(nativeError),
      "The owner retains the exact native startup error",
    );
    assert.equal(
      spec.mode === "native-bind-close-failure"
        ? (originalStartupError as Error).cause
        : originalStartupError,
      nativeError,
      "The entrypoint preserves the original native error identity and cause",
    );
    assert.equal(first.owner.state.boot, "failed");
    assert.equal(first.owner.state.phase, "failed");
    assert.equal(first.owner.state.retainedResources.includes("http.server"), false);
    assert.equal(
      first.owner.state.errors.some(
        (diagnostic) => diagnostic.code === "ACQUISITION_OUTCOME_UNKNOWN",
      ),
      false,
    );
  }
  if (unknownNativeAcquisition) {
    const state = first.owner.state;
    assert.equal(state.phase, "failed");
    assert.equal(state.boot, "failed");
    assert.equal(state.cleanup, "failed");
    assert.ok(state.retainedResources.includes("http.server"));
    assert.ok(state.retainedResources.includes("bootstrap.providers"));
    assert.ok(state.retainedResources.includes("core.database.pool.main"));
    const unknown = state.errors.find(
      (diagnostic) =>
        diagnostic.code === "ACQUISITION_OUTCOME_UNKNOWN" && diagnostic.resource === "http.server",
    );
    assert.ok(unknown);
    assert.equal(
      unknown.error,
      originalStartupError,
      "The exact original native exception remains inspectable",
    );
    assert.equal(
      first.events.some((event) => event.endsWith(".close") || event.endsWith(".flush")),
      false,
    );
    assert.equal(leaves(error).includes(first.cleanupError), false);
    await assertClosedAdmission(first);
    await released(first, false);
    report.inputClassification = spec.classification;
    report.classification = "expected-unknown-retention";
    report.disposition = "expected-unknown-retention";
    report.retryDisposition =
      "Not attempted: native acquisition outcome and dependent resources remain retained by the failed owner.";
  } else if (spec.mode === "native-bind-close-failure") {
    assert.equal(first.owner.state.cleanup, "failed");
    assert.deepEqual([...first.owner.state.retainedResources].sort(), [
      "bootstrap.providers",
      "core.database.pool.main",
      "database.readiness",
      "starter.cache",
      "starter.queue",
    ]);
    assert.ok(leaves(error).includes(first.cleanupError));
    assert.ok(
      first.owner.state.errors.some(
        (diagnostic) =>
          diagnostic.kind === "cleanup" && leaves(diagnostic.error).includes(first.cleanupError),
      ),
    );
    await released(first, true);
    await assertClosedAdmission(first);
    report.retryDisposition =
      "Not attempted: provider close failed; the owner retains provider ownership and its backing database, readiness, cache, and queue resources.";
  } else if (drainFailed) {
    assert.ok(leaves(error).includes(first.drainError));
    assert.equal(
      first.events.some((v) => v.endsWith(".close") || v.endsWith(".flush")),
      false,
    );
    await released(first, false);
    report.retryDisposition =
      "Not attempted after failed drain; infrastructure intentionally remains open.";
    report.activeAfterFailedDrain = active(first);
  } else {
    if (!["success", "late-handler-failure"].includes(spec.mode)) assert.ok(error);
    else assert.equal(error, undefined);
    if (spec.mode === "native-bind-failure") {
      assert.equal(first.owner.state.cleanup, "clean");
      assert.deepEqual(first.owner.state.retainedResources, []);
    }
    await released(first, true);
    assert.equal(active(first), false);
    await assertClosedAdmission(first);
    assert.deepEqual(
      first.events.filter((v) => v.endsWith(".close")),
      ["B.close", "A.close"],
    );
    const retry = begin("success");
    const app = await api.createAppServer(options);
    context = app.context;
    assert.equal(retry.factoryCalls, 1);
    assert.equal(retry.handlers, 0);
    const registered = getRouteInventory(app.routes).filter((r) => r.path === "/startup-probe");
    assert.equal(registered.length, 1);
    assert.equal(registered[0]?.openApi?.summary, "owned-startup-probe");
    server = app.server;
    assert.ok(server);
    const response = await fetch(new URL("/startup-probe", server.url));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "owned-app-handler");
    assert.equal(retry.handlers, 1);
    await Promise.all([context.dispose(), context.dispose()]);
    context = undefined;
    await released(retry, true);
    assert.equal(active(retry), false);
    await assertClosedAdmission(retry);
    report.retryDisposition =
      "Corrected retry succeeded with one factory call and one coherent metadata owner.";
  }
  if (occupier) assert.equal(await (await fetch(occupier.url)).text(), "owned-occupier");
  report.attempts = attempts.map(snapshot);
} catch (error) {
  failure = error;
} finally {
  // Fixture-owned final recovery is reported separately, never as automatic framework cleanup.
  report.attempts = attempts.map(snapshot);
  report.readyBeforeHarnessRecovery = attempts.map((attempt) =>
    attempt.owner ? active(attempt) : null,
  );
  const cleanupErrors: unknown[] = [];
  for (const close of [
    () => server?.stop(true),
    () => occupier?.stop(true),
    ...attempts.flatMap((a) => a.resources.map((r) => () => r.server.stop(true))),
  ]) {
    try {
      await close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  report.harnessCleanup = {
    ownedListenersStopped: cleanupErrors.length === 0,
    unknownResourcesRemoved: false,
    applicationCleanupConfirmed: attempts.every(
      (attempt) => attempt.owner?.state.cleanup === "clean",
    ),
    forcedOwnedListenerRecoveryAfterUnknownAcquisition: unknownNativeAcquisition,
    forcedOwnedRecoveryAfterDrainFailure: ["drain-failure", "startup-drain-failure"].includes(
      spec.mode,
    ),
    errors: cleanupErrors.map(String),
  };
  if (cleanupErrors.length)
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      "Probe and fixture cleanup failed",
    );
  report.status = failure ? "FAILED" : "COMPLETE";
  if (failure) report.failure = failure instanceof Error ? failure.stack : String(failure);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}
if (failure) throw failure;
