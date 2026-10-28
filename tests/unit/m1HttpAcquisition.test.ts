import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";
import { routeRegistry } from "../../src/bootstrap/routeRegistry";
import { createWebServer } from "../../src/bootstrap/web/server";

for (const rejected of ["stop", "drain", "force"]) {
  test(`HTTP ${rejected} registration rejects before acquiring a native listener`, async () => {
    const serve = Bun.serve;
    const lifecycle = new LifecycleCoordinator();
    const register = lifecycle.register.bind(lifecycle);
    const primary = new Error(`owned-${rejected}-registration`);
    const owned: ReturnType<typeof Bun.serve>[] = [];
    let callerClose = 0;
    lifecycle.register("caller:close", () => {
      callerClose++;
    });
    lifecycle.register = (name, handler, phase) => {
      if (phase === rejected) throw primary;
      return register(name, handler, phase);
    };
    Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
      const server = serve(options);
      owned.push(server);
      return server;
    }) as typeof Bun.serve;
    try {
      expect(() =>
        createWebServer({ port: 0, native: { hostname: "127.0.0.1" }, lifecycle }),
      ).toThrow(primary);
      expect(owned.length).toBe(0);
      expect((await lifecycle.shutdown()).successful).toBe(true);
      expect(callerClose).toBe(1);
    } finally {
      Bun.serve = serve;
      for (const server of owned) await server.stop(true);
    }
  });
}

test("early HTTP registration rejection restores owned metadata, closes providers once and permits a clean retry", async () => {
  const register = LifecycleCoordinator.prototype.register;
  const serve = Bun.serve;
  const owned: ReturnType<typeof Bun.serve>[] = [];
  const primary = new Error("owned-http-registration");
  let closed = 0;
  routeRegistry.clear();
  routeRegistry.register({ method: "GET", path: "/before-acquisition", middleware: [] });
  const providers = collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
  Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
    const server = serve(options);
    owned.push(server);
    return server;
  }) as typeof Bun.serve;
  LifecycleCoordinator.prototype.register = function (name, handler, phase) {
    if (name.startsWith("http:")) throw primary;
    return register.call(this, name, handler, phase);
  };
  try {
    await expect(
      startGuardedApplication({
        providers: [
          ...providers,
          {
            name: "owned",
            register({ onCleanup }) {
              onCleanup(() => {
                closed++;
              });
            },
          },
        ],
        modules: [],
      }),
    ).rejects.toBe(primary);
    expect(owned.length).toBe(0);
    expect(closed).toBe(1);
    expect(routeRegistry.list()).toEqual([
      { method: "GET", path: "/before-acquisition", middleware: [] },
    ]);
  } finally {
    Bun.serve = serve;
    LifecycleCoordinator.prototype.register = register;
    for (const server of owned) await server.stop(true);
  }
  const retry = await startGuardedApplication({ providers, modules: [] });
  expect((await retry.shutdown()).successful).toBe(true);
  expect(closed).toBe(1);
  routeRegistry.clear();
});
