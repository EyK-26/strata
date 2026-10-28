import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";

test("post-bind registration and actual socket-close failures retain both errors", async () => {
  const serve = Bun.serve;
  const register = LifecycleCoordinator.prototype.register;
  const primary = new Error("owned registration failure");
  const close = new Error("owned stop reported failure");
  let port: number | undefined;
  Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
    const server = serve(options);
    port = server.port;
    const stop = server.stop.bind(server);
    server.stop = async (force) => {
      await stop(force);
      throw close;
    };
    return server;
  }) as typeof Bun.serve;
  LifecycleCoordinator.prototype.register = function (name, handler, phase) {
    if (name === "m1:providers:drain") throw primary;
    return register.call(this, name, handler, phase);
  };
  const providers = collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
  let failure: unknown;
  try {
    await startGuardedApplication({ providers, modules: [] });
  } catch (error) {
    failure = error;
  } finally {
    Bun.serve = serve;
    LifecycleCoordinator.prototype.register = register;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).cause).toBe(primary);
  expect((failure as AggregateError).errors).toContain(close);
  if (!port) throw new Error("Owned socket did not bind");
  const reused = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("released") });
  try {
    expect(await (await fetch(reused.url)).text()).toBe("released");
  } finally {
    await reused.stop(true);
  }
  await expect(startGuardedApplication({ providers, modules: [] })).rejects.toThrow(
    "already active",
  );
});
