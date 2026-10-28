/** Opt-in current public-package observations, not implementation of a major API.
 * Copy byte-for-byte into a fresh exact-installed package as consumer.test.ts.
 * The last case intentionally cannot dispose its failed-drain context; only its
 * fixture-owned socket is forcibly cleaned, and the isolated process then exits.
 */
import { expect, test } from "bun:test";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { collectProviders, createAppContext } from "@getstrata/bootstrap/context";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { resolveApplicationConfig } from "@getstrata/core/runtime/applicationRegistry";

const base = () =>
  collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );

test("factory rejection happens after provider publication and raw collection clears prior metadata", async () => {
  let closed = 0;
  let calls = 0;
  const context = await createAppContext([
    ...base(),
    {
      name: "owned",
      register({ onCleanup }) {
        onCleanup(() => {
          closed++;
        });
      },
    },
  ]);
  const original = new Error("owned factory rejection");
  routeRegistry.register({ method: "GET", path: "/owned-before", middleware: [] });
  try {
    expect(resolveApplicationConfig()).toBe(context.config);
    expect(() =>
      buildModuleRoutes(context.dependencies, {
        modules: [
          {
            name: "owned-factory",
            routes() {
              calls++;
              expect(resolveApplicationConfig()).toBe(context.config);
              throw original;
            },
          },
        ],
      }),
    ).toThrow(original);
    expect(calls).toBe(1);
    expect(routeRegistry.list()).toEqual([]);
    expect(closed).toBe(0);
    expect(resolveApplicationConfig()).toBe(context.config);
  } finally {
    await context.dispose();
    routeRegistry.clear();
  }
  expect(closed).toBe(1);
  expect(() => resolveApplicationConfig()).toThrow("not been bootstrapped");
});

test("raw native bind failure leaves supplied context and collected metadata caller-owned", async () => {
  const context = await createAppContext(base());
  const occupied = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("owned occupied"),
  });
  const port = occupied.port;
  if (port === undefined) throw new Error("Owned TCP listener has no port.");
  let unexpected: ReturnType<typeof createWebServer> | undefined;
  try {
    const routes = buildModuleRoutes(context.dependencies, {
      modules: [
        {
          name: "owned-candidate",
          routes: () => ({ "/owned-candidate": { GET: () => new Response("candidate") } }),
        },
      ],
    });
    const before = routeRegistry.list();
    expect(before.some((route) => route.path === "/owned-candidate")).toBe(true);
    let failure: unknown;
    try {
      unexpected = createWebServer({
        port,
        native: { hostname: "127.0.0.1" },
        routes,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/EADDRINUSE|Failed to start server|port.*use/i);
    expect(resolveApplicationConfig()).toBe(context.config);
    expect(routeRegistry.list()).toEqual(before);
    expect(await (await fetch(occupied.url)).text()).toBe("owned occupied");
  } finally {
    await unexpected?.stop(true);
    await occupied.stop(true);
    await context.dispose();
    routeRegistry.clear();
  }
});

test("reported close failure and independently observed socket release are different facts", async () => {
  const resource = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("owned close"),
  });
  const port = resource.port;
  if (port === undefined) throw new Error("Owned TCP listener has no port.");
  const closeFailure = new Error("owned close reported failure");
  let closes = 0;
  const context = await createAppContext([
    ...base(),
    {
      name: "owned-close",
      register({ onCleanup }) {
        onCleanup(async () => {
          closes++;
          await resource.stop(true);
          throw closeFailure;
        });
      },
    },
  ]);
  let rebound: ReturnType<typeof Bun.serve> | undefined;
  try {
    expect(await (await fetch(resource.url)).text()).toBe("owned close");
    const first = context.dispose();
    expect(context.dispose()).toBe(first);
    let failure: unknown;
    try {
      await first;
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toContain(closeFailure);
    expect(closes).toBe(1);
    expect(() => resolveApplicationConfig()).toThrow("not been bootstrapped");
    rebound = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("owned rebound"),
    });
    expect(await (await fetch(rebound.url)).text()).toBe("owned rebound");
  } finally {
    await rebound?.stop(true);
    await resource.stop(true);
  }
});

test("failed drain keeps services and the owned resource available; repeated disposal is not recovery", async () => {
  const resource = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("owned retained"),
  });
  let drains = 0;
  let closes = 0;
  const context = await createAppContext([
    ...base(),
    {
      name: "owned-drain",
      register({ onCleanup }) {
        onCleanup(() => {
          drains++;
          throw new Error("owned failed drain");
        }, "drain");
        onCleanup(async () => {
          closes++;
          await resource.stop(true);
        });
      },
    },
  ]);
  try {
    const disposal = context.dispose();
    await expect(disposal).rejects.toThrow("Provider drain failed");
    expect(context.dispose()).toBe(disposal);
    await expect(context.dispose()).rejects.toThrow("Provider drain failed");
    expect(resolveApplicationConfig()).toBe(context.config);
    expect(drains).toBe(1);
    expect(closes).toBe(0);
    expect(await (await fetch(resource.url)).text()).toBe("owned retained");
  } finally {
    // Fixture cleanup only. No production restart or lease/force-close policy follows.
    await resource.stop(true);
  }
});
