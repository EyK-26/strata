/** Isolated process: failed-drain/startup reservations deliberately survive until exit. */
import assert from "node:assert/strict";
import { collectProviders } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "@getstrata/bootstrap/m1";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { resolveApplicationDependencies } from "@getstrata/core/runtime/applicationRegistry";

export async function runM1LifecycleProbe(mode: string | undefined) {
  assert.ok(
    ["failed-drain", "ownership-change", "failed-close", "provider-rejection"].includes(mode ?? ""),
  );
  const resource = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("owned-resource"),
  });
  const port = resource.port;
  assert.ok(port);
  const original = new Error("owned-primary");
  const closeError = new Error("owned-close");
  let closes = 0;
  let app: Awaited<ReturnType<typeof startGuardedApplication>> | undefined;
  const base = collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
  routeRegistry.register({ method: "GET", path: "/before", middleware: [] });
  try {
    let failure: unknown;
    try {
      app = await startGuardedApplication({
        providers: [
          ...base,
          {
            name: "owned",
            register({ onCleanup }) {
              onCleanup(async () => {
                closes++;
                await resource.stop(true);
                if (mode === "failed-close") throw closeError;
              });
              if (mode === "failed-drain")
                onCleanup(() => {
                  throw original;
                }, "drain");
            },
            boot() {
              if (mode === "provider-rejection") throw original;
            },
          },
        ],
        modules: [
          {
            name: "candidate",
            routes() {
              if (mode === "failed-close") throw original;
              return { "/candidate": () => new Response("candidate") };
            },
          },
        ],
      });
    } catch (error) {
      failure = error;
    }
    if (mode === "failed-close") {
      assert.ok(failure instanceof AggregateError);
      assert.equal(failure.cause, original);
      assert.equal(closes, 1);
    } else if (mode === "provider-rejection") {
      assert.equal(failure, original);
      assert.equal(closes, 1);
    } else {
      assert.ok(app);
      if (mode === "ownership-change")
        routeRegistry.register({ method: "GET", path: "/foreign", middleware: [] });
      const stopping = app.shutdown();
      const result = await stopping;
      assert.equal(app.shutdown(), stopping);
      assert.equal(result.successful, false);
      if (mode === "failed-drain") {
        assert.equal(closes, 0);
        assert.equal(resolveApplicationDependencies(), app.context.dependencies);
        assert.equal(await (await fetch(resource.url)).text(), "owned-resource");
      } else {
        assert.ok(routeRegistry.list().some((row) => row.path === "/foreign"));
        assert.equal(closes, 1);
      }
    }
    await assert.rejects(
      startGuardedApplication({ providers: base, modules: [] }),
      /already active/,
    );
    if (closes) {
      const reused = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch: () => new Response("reused"),
      });
      try {
        assert.equal(await (await fetch(reused.url)).text(), "reused");
      } finally {
        await reused.stop(true);
      }
    }
    return {
      mode,
      originalCauseRetained:
        mode !== "failed-close" || (failure as AggregateError).cause === original,
      closes,
      retryBlocked: true,
      ownedResourceRetainedOnFailedDrain: mode === "failed-drain",
      foreignMetadataPreserved:
        mode !== "ownership-change" || routeRegistry.list().some((row) => row.path === "/foreign"),
      fixtureCleanupOnly: true,
    };
  } finally {
    await app?.server.stop(true);
    await resource.stop(true);
  }
}
if (import.meta.main) console.log(JSON.stringify(await runM1LifecycleProbe(process.argv[2])));
