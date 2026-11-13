/** Installed public route collection and real HTTP precedence contract. */
import assert from "node:assert/strict";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
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
  const routes = buildModuleRoutes(app.context.dependencies, { apiPrefix: "/contracts/", modules });
  server = createWebServer({ port: 0, native: { hostname: "127.0.0.1" }, routes });
  for (const [method, body] of [
    ["GET", "read"],
    ["POST", "write"],
  ]) {
    const response: Response = await fetch(new URL("/contracts/shared", server.url), { method });
    assert.equal(await response.text(), body);
    assert.ok(response.headers.get("x-request-id"));
  }
  assert.deepEqual(routeRegistry.list(), [
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
  const before = routeRegistry.list();
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
  assert.deepEqual(routeRegistry.list(), before, "Invalid plans must not change the registry.");
  await server.stop(true);
  server = undefined;
  console.log(
    "PASS installed route normalization, disjoint methods and collision rejection over real HTTP",
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
