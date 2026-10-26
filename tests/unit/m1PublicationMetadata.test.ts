/** Isolated file: foreign metadata deliberately leaves the startup reservation unsafe. */
import { expect, test } from "bun:test";
import { collectProviders, createAppContext } from "@getstrata/bootstrap/context";
import {
  clearActiveApplicationContext,
  resolveApplicationConfig,
  setActiveApplicationContext,
} from "@getstrata/core/runtime/applicationRegistry";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";
import { describeM1Failure } from "../../src/bootstrap/m1/diagnostics";
import { routeRegistry } from "../../src/bootstrap/routeRegistry";

test("publication ownership error preserves its cause and never restores over foreign metadata", async () => {
  const providers = collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
  let candidateCloses = 0;
  let foreignCloses = 0;
  const foreign = await createAppContext([
    ...providers,
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
  routeRegistry.clear();
  routeRegistry.register({ method: "GET", path: "/before", middleware: [] });
  const register = routeRegistry.register;
  routeRegistry.register = function (row) {
    register.call(this, row);
    if (row.path === "/candidate") setActiveApplicationContext(foreign);
  };
  let app: Awaited<ReturnType<typeof startGuardedApplication>> | undefined;
  let failure: unknown;
  try {
    try {
      app = await startGuardedApplication({
        providers: [
          ...providers,
          {
            name: "candidate",
            register({ onCleanup }) {
              onCleanup(() => {
                candidateCloses++;
                routeRegistry.register({
                  method: "GET",
                  path: "/foreign-cleanup",
                  middleware: [],
                });
              });
            },
          },
        ],
        modules: [
          { name: "candidate", routes: () => ({ "/candidate": () => new Response("ok") }) },
        ],
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(app).toBeUndefined();
    const primary = (failure as AggregateError).cause;
    expect(describeM1Failure(primary)).toEqual({
      stage: "publication",
      code: "context-ownership-changed",
      field: "context",
      owner: "application",
    });
    expect((failure as AggregateError).errors[0]).toBe(primary);
    expect(describeM1Failure(failure).stage).toBe("cleanup");
    expect(candidateCloses).toBe(1);
    expect(foreignCloses).toBe(0);
    expect(resolveApplicationConfig()).toBe(foreign.config);
    const retained = routeRegistry.list();
    expect(retained.some((row) => row.path === "/foreign-cleanup")).toBe(true);
    expect(retained.some((row) => row.path === "/before")).toBe(false);
    await expect(startGuardedApplication({ providers, modules: [] })).rejects.toThrow(
      "already active",
    );
    await foreign.dispose();
    expect(foreignCloses).toBe(1);
    await expect(startGuardedApplication({ providers, modules: [] })).rejects.toThrow(
      "already active",
    );
    expect(routeRegistry.list()).toEqual(retained);
  } finally {
    routeRegistry.register = register;
    await app?.shutdown();
    await app?.server.stop(true);
    await foreign.dispose();
  }
});
