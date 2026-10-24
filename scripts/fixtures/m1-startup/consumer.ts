import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { appContext } from "@getstrata/bootstrap/context";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { type Attempt, attempts, begin } from "./state.ts";
import type { ProbeCase } from "./types.ts";

const input = process.argv[2];
const output = process.argv[3];
assert.ok(input && output);
const spec: ProbeCase = await Bun.file(input).json();
const report: Record<string, unknown> = { mode: spec.mode, classification: spec.classification };
function active() {
  try {
    return !!appContext.container;
  } catch {
    return false;
  }
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
let closeDatabase: (() => Promise<void>) | undefined;
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
  const api: {
    createApp(options: { migrate: false }): Promise<{
      context: { dispose(): Promise<void> };
      routes: Parameters<
        typeof import("@getstrata/bootstrap/web/server").createWebServer
      >[0]["routes"];
    }>;
    createAppServer(
      routes: object,
      port: number,
      lifecycle?: undefined,
      native?: { hostname: string },
    ): ReturnType<typeof Bun.serve>;
  } = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
  closeDatabase = (await import(new URL("../bootstrap/database.ts", import.meta.url).href))
    .closeDatabase;
  assert.ok(closeDatabase);
  routeRegistry.register({ method: "GET", path: "/previous-snapshot", middleware: [] });
  report.registryBefore = routeRegistry.list();
  let error: unknown;
  let callerCleanup = false;
  if (spec.mode.startsWith("native-bind")) {
    try {
      await import(new URL("../bootstrap/server.ts", import.meta.url).href);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, "The occupied generated entrypoint must reject.");
    const errors = leaves(error);
    report.nativeBindFailureRetained = errors.some((e) => Reflect.get(e, "code") === "EADDRINUSE");
    if (spec.mode === "native-bind-close-failure") {
      assert.ok(errors.includes(first.cleanupError));
      // Published2.2.54 is a dated defect; a candidate must retain the original bind failure.
      if (spec.classification === "contract-control") {
        assert.ok(error instanceof AggregateError);
        const originalBindFailure = errors.find((e) => Reflect.get(e, "code") === "EADDRINUSE");
        assert.ok(
          originalBindFailure,
          "Native bind failure must remain inspectable after cleanup rejects.",
        );
        assert.equal(error.cause, originalBindFailure);
      }
      assert.equal(
        errors.some((e) => Reflect.get(e, "code") === "EADDRINUSE"),
        spec.classification === "contract-control",
      );
    } else assert.ok(errors.some((e) => Reflect.get(e, "code") === "EADDRINUSE"));
  } else {
    try {
      const app = await api.createApp({ migrate: false });
      context = app.context;
      assert.equal(first.handlers, 0, "Bootstrap must not invoke fixture business handlers.");
      report.contextPublishedBeforeTransport = active();
      if (spec.mode !== "drain-failure") {
        server = api.createAppServer(app.routes ?? {}, 0, undefined, { hostname: "127.0.0.1" });
        assert.ok(server.port);
        const response = await fetch(new URL("/startup-probe", server.url));
        report.firstHttp = { status: response.status, body: await response.text() };
        assert.equal(response.status, spec.mode === "late-handler-failure" ? 500 : 200);
        assert.equal(first.handlers, 1);
        await server.stop(true);
        server = undefined;
      }
      await Promise.all([context.dispose(), context.dispose()]);
      context = undefined;
      await closeDatabase();
    } catch (caught) {
      error = caught;
      if (spec.mode === "native-bad-pattern") {
        assert.ok(context);
        report.activeAfterConstructorFailure = active();
        assert.equal(
          first.resources.every((v) => v.closed === 0),
          true,
        );
        callerCleanup = true;
        await context.dispose();
        context = undefined;
        await closeDatabase();
      }
    }
  }
  report.fixtureStartupMarkerRetained = leaves(error).includes(first.startupError);
  report.errors = describe(error);
  report.registryAfter = routeRegistry.list();
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
  if (spec.mode === "dependency-missing") assert.match(String(error), /dependency "cache"/);
  if (spec.mode === "orphan-metadata") assert.match(String(error), /no API route/);
  const drainFailed = ["drain-failure", "startup-drain-failure"].includes(spec.mode);
  if (drainFailed) {
    assert.ok(leaves(error).includes(first.drainError));
    assert.equal(
      first.events.some((v) => v.endsWith(".close") || v.endsWith(".flush")),
      false,
    );
    await released(first, false);
    report.retryDisposition =
      "Not attempted after failed drain; infrastructure intentionally remains open.";
    report.activeAfterFailedDrain = active();
  } else {
    if (!["success", "late-handler-failure"].includes(spec.mode)) assert.ok(error);
    else assert.equal(error, undefined);
    await released(first, true);
    assert.equal(active(), false);
    assert.deepEqual(
      first.events.filter((v) => v.endsWith(".close")),
      ["B.close", "A.close"],
    );
    const retry = begin("success");
    const app = await api.createApp({ migrate: false });
    context = app.context;
    assert.equal(retry.factoryCalls, 1);
    assert.equal(retry.handlers, 0);
    const registered = routeRegistry.list().filter((r) => r.path === "/startup-probe");
    assert.equal(registered.length, 1);
    assert.equal(registered[0]?.openApi?.summary, "owned-startup-probe");
    server = api.createAppServer(app.routes ?? {}, 0, undefined, { hostname: "127.0.0.1" });
    const response = await fetch(new URL("/startup-probe", server.url));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "owned-app-handler");
    assert.equal(retry.handlers, 1);
    await server.stop(true);
    server = undefined;
    await Promise.all([context.dispose(), context.dispose()]);
    context = undefined;
    await closeDatabase();
    await released(retry, true);
    assert.equal(active(), false);
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
  report.activeBeforeHarnessRecovery = active();
  const cleanupErrors: unknown[] = [];
  for (const close of [
    () => server?.stop(true),
    () => occupier?.stop(true),
    ...attempts.flatMap((a) => a.resources.map((r) => () => r.server.stop(true))),
    () => closeDatabase?.(),
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
