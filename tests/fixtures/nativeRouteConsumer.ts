/** Real HTTP consumer using only public installed bootstrap/core APIs. */
import assert from "node:assert/strict";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import type { BunRequest, Server } from "bun";

const template = new Response("static body", { status: 201, headers: { "x-static": "yes" } });
const seen: string[] = [];
let admitted: Request | undefined;
const handler = (request: BunRequest<"/things/:id">, native?: Server<unknown>) => {
  assert.equal(request, admitted);
  return Response.json({ id: request.params.id, port: native?.port });
};
const server = createWebServer({
  port: 0,
  native: { hostname: "127.0.0.1" },
  routes: {
    "/static": template,
    "/method": {
      PATCH: new Response("patched", { status: 202 }),
      OPTIONS: new Response("explicit", { status: 203 }),
    },
    "/things/:id": handler,
    "/posted/:id": { POST: handler },
  },
  onRequest(request) {
    admitted = request;
    seen.push(`${request.method} ${currentRequestMeta().routeTemplate}`);
    if (request.headers.has("x-reject")) return new Response("rejected", { status: 429 });
  },
});
try {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "GET"]) {
    const response = await fetch(new URL("/static", server.url), { method });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-static"), "yes");
    assert.equal(await response.text(), method === "HEAD" ? "" : "static body");
  }
  assert.deepEqual(seen, [
    "GET /static",
    "HEAD /static",
    "POST /static",
    "PUT /static",
    "PATCH /static",
    "DELETE /static",
    "GET /static",
  ]);
  const rejected = await fetch(new URL("/static", server.url), { headers: { "x-reject": "1" } });
  assert.equal(rejected.status, 429);
  assert.equal(await rejected.text(), "rejected");
  assert.equal((await fetch(new URL("/static", server.url), { method: "OPTIONS" })).status, 204);
  for (let count = 0; count < 2; count++) {
    const response = await fetch(new URL("/method", server.url), { method: "PATCH" });
    assert.equal(response.status, 202);
    assert.equal(await response.text(), "patched");
  }
  const options = await fetch(new URL("/method", server.url), { method: "OPTIONS" });
  assert.equal(options.status, 203);
  assert.equal(await options.text(), "explicit");
  for (const [path, method] of [
    ["/things/12", "GET"],
    ["/posted/12", "POST"],
  ] as const) {
    assert.deepEqual(await (await fetch(new URL(path, server.url), { method })).json(), {
      id: "12",
      port: server.port,
    });
  }
  assert.equal(template.bodyUsed, false);
} finally {
  await server.stop(true);
}

// This URL resolves only after copying into the generated app. Its bootstrap is
// typechecked there; use its real providers and the already migrated runtime URL.
const application: {
  createApp(options: { migrate: false }): Promise<{ context: InitializedAppContext }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
const app = await application.createApp({ migrate: false });
try {
  const routes = buildModuleRoutes(app.context.dependencies, {
    modules: [
      {
        name: "response-contract",
        routes: () => ({
          "/module": new Response("module body", { status: 201 }),
          "/mixed": { GET: new Response("mixed body"), POST: new Response("mixed write") },
          "/wrapped/:id": { GET: handler },
        }),
      },
    ],
  });
  const web = buildWebModuleRoutes(app.context.dependencies, {
    modules: [
      {
        name: "web-response-contract",
        webRoutes: () => ({ "/web-static": new Response("web body") }),
      },
    ],
  });
  const moduleServer = createWebServer({
    port: 0,
    native: { hostname: "127.0.0.1" },
    routes: { ...routes, ...web },
    onRequest(request) {
      admitted = request;
    },
  });
  try {
    const read = await fetch(new URL("/module", moduleServer.url));
    assert.equal(read.status, 201);
    assert.equal(await read.text(), "module body");
    assert.ok(read.headers.get("x-request-id"));
    const csrfCookie = read.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(csrfCookie);
    const rejected = await fetch(new URL("/module", moduleServer.url), { method: "POST" });
    assert.equal(rejected.status, 403);
    assert.deepEqual(await rejected.json(), { error: "Invalid or missing CSRF token." });
    const csrfHeaders = {
      cookie: csrfCookie,
      "x-csrf-token": decodeURIComponent(csrfCookie.slice(csrfCookie.indexOf("=") + 1)),
      origin: moduleServer.url.origin,
    };
    for (const [path, body] of [
      ["/module", "module body"],
      ["/mixed", "mixed write"],
    ] as const) {
      const result = await fetch(new URL(path, moduleServer.url), {
        method: "POST",
        headers: csrfHeaders,
      });
      assert.ok(result.headers.get("x-request-id"));
      assert.equal(await result.text(), body);
    }
    assert.deepEqual(await (await fetch(new URL("/wrapped/12", moduleServer.url))).json(), {
      id: "12",
      port: moduleServer.port,
    });
    const webRead = await fetch(new URL("/web-static", moduleServer.url));
    assert.equal(await webRead.text(), "web body");
    assert.ok(webRead.headers.get("x-request-id"));
  } finally {
    await moduleServer.stop(true);
  }
} finally {
  await app.context.dispose();
}

const lifecycle = new LifecycleCoordinator({ timeoutMs: 2000 });
let enter!: () => void;
let release!: () => void;
const entered = new Promise<void>((resolve) => {
  enter = resolve;
});
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
let finished = false;
let closed = false;
const draining = createWebServer({
  port: 0,
  native: { hostname: "127.0.0.1" },
  lifecycle,
  routes: { "/static": new Response("drained") },
  async onRequest() {
    enter();
    await gate;
    finished = true;
  },
});
lifecycle.register(
  "infrastructure",
  () => {
    assert.equal(finished, true);
    closed = true;
  },
  "close",
);
const result = fetch(new URL("/static", draining.url));
try {
  await entered;
  const shutdown = lifecycle.shutdown("DEPLOYMENT");
  await Bun.sleep(20);
  assert.equal(closed, false);
  release();
  assert.equal((await shutdown).successful, true);
  assert.equal(await (await result).text(), "drained");
  assert.equal(closed, true);
} finally {
  release();
  await draining.stop(true);
}
console.log("PASS installed native static/method responses, server callbacks, admission and drain");
