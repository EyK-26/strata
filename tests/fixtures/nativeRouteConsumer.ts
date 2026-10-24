/** Real HTTP consumer using only public installed bootstrap/core APIs. */
import assert from "node:assert/strict";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import { routeParams, toRouteRequest } from "@getstrata/bootstrap/web/routing";
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
// This URL resolves only after copying into the generated app. Its bootstrap is
// typechecked there; use its real providers and the already migrated runtime URL.
const application: {
  createApp(options: { migrate: false }): Promise<{ context: InitializedAppContext }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
const app = await application.createApp({ migrate: false });
try {
  const file = Bun.file(new URL("../bootstrap/createApp.ts", import.meta.url));
  const routes = buildModuleRoutes(app.context.dependencies, {
    modules: [
      {
        name: "response-contract",
        routes: () => ({
          "/module": new Response("module body", { status: 201 }),
          "/mixed": { GET: new Response("mixed body"), POST: new Response("mixed write") },
          "/wrapped/:id": { GET: handler },
          "/file": file,
          "/partial": {
            GET: () => new Response("partial read"),
            POST: () => new Response("partial write"),
            inert: false,
          },
        }),
      },
    ],
  });
  const web = buildWebModuleRoutes(app.context.dependencies, {
    modules: [
      {
        name: "web-response-contract",
        webRoutes: () => ({ "/web-static": new Response("web body"), "/web-file": file }),
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
    assert.equal(routes["/file"], file);
    assert.equal(web["/web-file"], file);
    assert.equal(routes["/partial"].inert, false);
    const partialRejection = await fetch(new URL("/partial", moduleServer.url), { method: "POST" });
    assert.equal(partialRejection.status, 403);
    assert.deepEqual(await partialRejection.json(), { error: "Invalid or missing CSRF token." });
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
      ["/partial", "partial write"],
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
    "/encoded/:id": (request: BunRequest<"/encoded/:id">) => {
      const nativeParams = request.params;
      const native = { ...request.params };
      const copied = routeParams(request);
      assert.equal(request.params, nativeParams);
      assert.deepEqual({ ...request.params }, native);
      assert.equal(toRouteRequest(request), request);
      const first = { ...request.params };
      assert.equal(toRouteRequest(request), request);
      return Response.json({ native, copied, first, second: request.params });
    },
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
  for (const [encoded, id] of [
    ["42", "42"],
    ["caf%C3%A9", "café"],
    ["100%25", "100%"],
    ["%252F", "%2F"],
    ["a%2Fb", "a/b"],
    ["%2525", "%25"],
    ["%25E0%25A4%25A", "%E0%A4%A"],
  ]) {
    const response = await fetch(new URL(`/encoded/${encoded}`, server.url));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      native: { id },
      copied: { id },
      first: { id },
      second: { id },
    });
  }
  assert.equal(template.bodyUsed, false);
} finally {
  await server.stop(true);
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

// A native key that coincides with Object.prototype must remain an own string value.
const ownKeyServer = createWebServer({
  port: 0,
  native: { hostname: "127.0.0.1" },
  routes: {
    "/keys/:__proto__": (request: BunRequest<"/keys/:__proto__">) => {
      const nativeOwn = Object.hasOwn(request.params, "__proto__");
      const nativeValue = Reflect.get(request.params, "__proto__");
      const copied = routeParams(request);
      const first = toRouteRequest<{ __proto__: string }>(request);
      const firstOwn = Object.hasOwn(first.params, "__proto__");
      const firstValue = Object.getOwnPropertyDescriptor(first.params, "__proto__")?.value;
      const second = toRouteRequest<{ __proto__: string }>(request);
      return Response.json({
        nativeOwn,
        nativeValue,
        copiedOwn: Object.hasOwn(copied, "__proto__"),
        copiedValue: Object.getOwnPropertyDescriptor(copied, "__proto__")?.value,
        copiedPrototypeUnchanged: Object.getPrototypeOf(copied) === Object.prototype,
        firstOwn,
        firstValue,
        secondOwn: Object.hasOwn(second.params, "__proto__"),
        secondValue: Object.getOwnPropertyDescriptor(second.params, "__proto__")?.value,
        requestIdentityPreserved: first === request && second === request,
        adaptedPrototypeUnchanged: Object.getPrototypeOf(second.params) === Object.prototype,
      });
    },
  },
});
try {
  const response = await fetch(new URL("/keys/100%25", ownKeyServer.url));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    nativeOwn: true,
    nativeValue: "100%",
    copiedOwn: true,
    copiedValue: "100%",
    copiedPrototypeUnchanged: true,
    firstOwn: true,
    firstValue: "100%",
    secondOwn: true,
    secondValue: "100%",
    requestIdentityPreserved: true,
    adaptedPrototypeUnchanged: true,
  });
  console.log("PASS installed native own-parameter keys and plain-object/request identity");
} finally {
  await ownKeyServer.stop(true);
}
