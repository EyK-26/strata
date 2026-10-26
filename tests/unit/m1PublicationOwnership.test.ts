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

const providers = () =>
  collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );

for (const phase of ["collection", "publication"] as const) {
  test(`${phase} context replacement rejects before bind and cleans only the candidate`, async () => {
    let candidateCloses = 0;
    let foreignCloses = 0;
    const foreign = await createAppContext([
      ...providers(),
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
    const before = routeRegistry.list();
    const register = routeRegistry.register;
    const serve = Bun.serve;
    const listeners: ReturnType<typeof Bun.serve>[] = [];
    let changed = false;
    routeRegistry.register = function (row) {
      register.call(this, row);
      if (phase === "publication" && row.path === "/candidate" && !changed) {
        changed = true;
        setActiveApplicationContext(foreign);
      }
    };
    Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
      const listener = serve(options);
      listeners.push(listener);
      return listener;
    }) as typeof Bun.serve;
    let app: Awaited<ReturnType<typeof startGuardedApplication>> | undefined;
    let failure: unknown;
    try {
      try {
        app = await startGuardedApplication({
          providers: [
            ...providers(),
            {
              name: "candidate",
              register({ onCleanup }) {
                onCleanup(() => {
                  candidateCloses++;
                });
              },
            },
          ],
          modules: [
            {
              name: "candidate",
              routes() {
                if (phase === "collection") setActiveApplicationContext(foreign);
                return { "/candidate": () => new Response("candidate") };
              },
            },
          ],
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(app).toBeUndefined();
      expect(listeners).toHaveLength(0);
      expect(describeM1Failure(failure)).toEqual({
        stage: phase,
        code: "context-ownership-changed",
        field: "context",
        owner: "application",
      });
      expect(candidateCloses).toBe(1);
      expect(foreignCloses).toBe(0);
      expect(resolveApplicationConfig()).toBe(foreign.config);
      expect(routeRegistry.list()).toEqual(before);
      await expect(
        startGuardedApplication({ providers: providers(), modules: [] }),
      ).rejects.toThrow("already active");
    } finally {
      Bun.serve = serve;
      routeRegistry.register = register;
      await app?.shutdown();
      for (const listener of listeners) await listener.stop(true);
      await foreign.dispose();
    }
    expect(foreignCloses).toBe(1);
    const retry = await startGuardedApplication({ providers: providers(), modules: [] });
    try {
      expect(retry.server.port).toBeGreaterThan(0);
    } finally {
      expect((await retry.shutdown()).successful).toBe(true);
      routeRegistry.clear();
    }
    expect(candidateCloses).toBe(1);
  });
}
