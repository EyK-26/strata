import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";

test("metadata mutation during failed-bind cleanup is retained and blocks automatic retry", async () => {
  const socket = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("occupied"),
  });
  const port = socket.port;
  if (!port) throw new Error("No port");
  const providers = collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
  routeRegistry.register({ method: "GET", path: "/before", middleware: [] });
  try {
    let failure: unknown;
    try {
      await startGuardedApplication({
        providers: [
          ...providers,
          {
            name: "cleanup-owner",
            register({ onCleanup }) {
              onCleanup(() => {
                routeRegistry.register({ method: "GET", path: "/foreign", middleware: [] });
              });
            },
          },
        ],
        modules: [],
        transport: { port },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(String((failure as AggregateError).cause)).toMatch(
      /Failed to start server|EADDRINUSE|port.*use/i,
    );
    expect(routeRegistry.list().some((route) => route.path === "/foreign")).toBe(true);
    await expect(startGuardedApplication({ providers, modules: [] })).rejects.toThrow(
      "already active",
    );
  } finally {
    await socket.stop(true);
  }
});
