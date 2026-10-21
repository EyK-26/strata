/** Installed public route collection and real HTTP precedence contract. */
import assert from "node:assert/strict";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { createWebServer } from "@getstrata/bootstrap/web/server";

const application: {
  createApp(options: { migrate: false }): Promise<{ context: InitializedAppContext }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
const database: { closeDatabase(): Promise<void> } = await import(
  new URL("../bootstrap/database.ts", import.meta.url).href
);
const app = await application.createApp({ migrate: false });
let server: ReturnType<typeof createWebServer> | undefined;
try {
  const routes = buildModuleRoutes(app.context.dependencies, {
    apiPrefix: "/contracts/",
    modules: [
      {
        name: "relative",
        routes: () => ({ shared: () => new Response("old") }),
        openApi: { shared: { GET: { summary: "Obsolete response" } } },
      },
      { name: "absolute", routes: () => ({ "/shared": () => new Response("current") }) },
    ],
  });
  server = createWebServer({ port: 0, native: { hostname: "127.0.0.1" }, routes });
  const response = await fetch(new URL("/contracts/shared", server.url));
  assert.equal(await response.text(), "current");
  assert.ok(response.headers.get("x-request-id"));
  assert.deepEqual(
    routeRegistry.list(),
    [{ method: "GET", path: "/contracts/shared", middleware: ["global", "api"] }],
    "The winning handler must not inherit a replaced alias's OpenAPI contract.",
  );
  await server.stop(true);
  server = undefined;

  const priority = buildModuleRoutes(app.context.dependencies, {
    apiPrefix: "/contracts/",
    modules: [
      { name: "first", routes: () => ({ "/shared": () => new Response("first") }) },
      {
        name: "second",
        routes: () => ({ shared: () => new Response("second") }),
        openApi: { shared: { GET: { summary: "Second raw path" } } },
      },
      { name: "third", routes: () => ({ "/shared": () => new Response("third") }) },
    ],
  });
  server = createWebServer({ port: 0, native: { hostname: "127.0.0.1" }, routes: priority });
  assert.equal(await (await fetch(new URL("/contracts/shared", server.url))).text(), "second");
  assert.deepEqual(routeRegistry.list(), [
    {
      method: "GET",
      path: "/contracts/shared",
      middleware: ["global", "api"],
      openApi: { summary: "Second raw path" },
    },
  ]);
  console.log(
    "PASS installed route alias metadata and existing raw-path precedence over real HTTP",
  );
} finally {
  try {
    await server?.stop(true);
  } finally {
    try {
      await app.context.dispose();
    } finally {
      await database.closeDatabase();
    }
  }
}
