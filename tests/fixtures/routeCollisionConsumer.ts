/** Installed public route collection and real HTTP precedence contract. */
import assert from "node:assert/strict";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { createSpaRoutes } from "@getstrata/bootstrap/createSpaRoutes";
import { mergeWebRoutes } from "@getstrata/bootstrap/createWebRoutes";
import { composeRouteMaps, getRouteInventory } from "@getstrata/bootstrap/routePlan";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import type { Application } from "@getstrata/core/contracts/application";

const application: {
  createApp(options: {
    migrate: false;
    onConstructed(owner: Application): undefined;
  }): Promise<{ context: InitializedAppContext; application: Application }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
let owner: Application | undefined;
const failures: unknown[] = [];
let server: ReturnType<typeof createWebServer> | undefined;
try {
  const app = await application.createApp({
    migrate: false,
    onConstructed: (application) => {
      owner = application;
    },
  });
  const modules: AppModule[] = [
    {
      name: "read",
      routes: () => ({ shared: { GET: () => new Response("read") } }),
      openApi: { shared: { GET: { summary: "Read contract" } } },
    },
    {
      name: "write",
      routes: () => ({ "/shared": { POST: () => new Response("write") } }),
      openApi: { "/shared": { POST: { summary: "Write contract" } } },
    },
  ];
  const apiRoutes = buildModuleRoutes(app.context.dependencies, {
    apiPrefix: "/contracts/",
    modules,
  });
  const apiInventory = getRouteInventory(apiRoutes);
  const previousMode = process.env.FRONTEND_MODE;
  process.env.FRONTEND_MODE = "server-htmx";
  let routes: typeof apiRoutes;
  try {
    const spa = createSpaRoutes(app.context.dependencies, {
      prefix: "/owned-spa",
      distDirectory: "/missing-owned-spa",
    });
    routes = mergeWebRoutes(
      app.context.dependencies,
      composeRouteMaps(apiRoutes, spa) as typeof apiRoutes,
      {
        modules: [
          {
            name: "owned-web",
            webRoutes: () => ({ "/owned-web": { GET: () => new Response("web") } }),
          },
        ],
      },
    );
  } finally {
    if (previousMode === undefined) delete process.env.FRONTEND_MODE;
    else process.env.FRONTEND_MODE = previousMode;
  }
  const inventory = getRouteInventory(routes);
  assert.ok(Object.isFrozen(inventory));
  assert.equal(Object.getOwnPropertySymbols(routes).length, 1);
  assert.deepEqual(getRouteInventory(apiRoutes), apiInventory);
  assert.deepEqual(
    inventory.filter((route) => route.path === "/contracts/shared"),
    apiInventory,
  );
  assert.deepEqual(
    inventory.find((route) => route.path === "/owned-web" && route.method === "GET")?.middleware,
    ["global", "web"],
  );
  assert.ok(inventory.some((route) => route.path === "/owned-spa/*"));
  server = createWebServer({ port: 0, native: { hostname: "127.0.0.1" }, routes });
  let csrfCookie = "";
  for (const [method, body] of [
    ["GET", "read"],
    ["POST", "write"],
  ]) {
    const response: Response = await fetch(new URL("/contracts/shared", server.url), {
      method,
      headers:
        method === "POST"
          ? {
              cookie: csrfCookie,
              "x-csrf-token": decodeURIComponent(csrfCookie.slice(csrfCookie.indexOf("=") + 1)),
              origin: server.url.origin,
            }
          : {},
    });
    csrfCookie = response.headers.getSetCookie()[0]?.split(";")[0] ?? csrfCookie;
    assert.equal(await response.text(), body);
    assert.ok(response.headers.get("x-request-id"));
  }
  assert.deepEqual(getRouteInventory(apiRoutes), [
    {
      method: "GET",
      path: "/contracts/shared",
      middleware: ["global", "api"],
      openApi: { summary: "Read contract" },
    },
    {
      method: "POST",
      path: "/contracts/shared",
      middleware: ["global", "api"],
      openApi: { summary: "Write contract" },
    },
    { method: "HEAD", path: "/contracts/shared", middleware: ["global", "api"] },
  ]);
  assert.equal(await (await fetch(new URL("/owned-web", server.url))).text(), "web");
  assert.equal((await fetch(new URL("/owned-spa/anything", server.url))).status, 503);
  const before = getRouteInventory(routes);
  assert.throws(
    () =>
      buildModuleRoutes(app.context.dependencies, {
        apiPrefix: "/contracts/",
        modules: [
          ...modules,
          {
            name: "duplicate",
            routes: () => ({ "/shared": { GET: () => new Response("duplicate") } }),
          },
        ],
      }),
    /Duplicate route/,
  );
  assert.deepEqual(
    getRouteInventory(routes),
    before,
    "Invalid plans must not change an existing owned inventory.",
  );
  await server.stop(true);
  server = undefined;
  console.log(
    "PASS mixed installed API/SPA/web entry composition preserves owned inventory and native HTTP methods",
  );
} catch (error) {
  failures.push(error);
} finally {
  try {
    await server?.stop(true);
  } catch (error) {
    failures.push(error);
  }
  if (owner) {
    try {
      assert.ok((await owner.stop()).successful);
    } catch (error) {
      failures.push(error);
    }
  }
}
if (failures.length === 1) throw failures[0];
if (failures.length > 1) throw new AggregateError(failures, "Route consumer and cleanup failed");
