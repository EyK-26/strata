import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { applyMiddlewareToRoutes } from "@getstrata/core/http/middleware";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import type { BunRequest, Server } from "bun";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies } from "../unit/testHelpers";

let previousOrigin: string | undefined;
let previousTenancy: string | undefined;
beforeEach(() => {
  previousOrigin = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = "https://client.example";
  previousTenancy = process.env.TENANCY_DRIVER;
  process.env.TENANCY_DRIVER = "none";
});
afterEach(() => {
  restoreEnvVar("CORS_ALLOWED_ORIGINS", previousOrigin);
  restoreEnvVar("TENANCY_DRIVER", previousTenancy);
  routeRegistry.clear();
});

describe("native route values at the framework server boundary", () => {
  test("module builders preserve opaque native values instead of replacing SDK objects", () => {
    const dependencies = createMockDependencies(new ServiceContainer());
    const file = Bun.file(new URL("../../index.html", import.meta.url));
    const directory = { dir: "./public" };
    const values = { "/file": file, "/directory": directory };
    const api = buildModuleRoutes(dependencies, {
      modules: [{ name: "native-values", routes: () => values }],
    });
    const web = buildWebModuleRoutes(dependencies, {
      modules: [{ name: "native-values", webRoutes: () => values }],
    });
    for (const routes of [api, web]) {
      expect(routes["/file"]).toBe(file);
      expect(routes["/file"]).toBeInstanceOf(Blob);
      expect(routes["/directory"]).toBe(directory);
    }
  });

  test("inert method-map fields cannot disable middleware around executable callbacks", async () => {
    const dependencies = createMockDependencies(new ServiceContainer());
    const routes = buildModuleRoutes(dependencies, {
      modules: [
        {
          name: "partial-method-map",
          routes: () => ({
            "/partial": {
              GET: () => new Response("read"),
              POST: () => new Response("write"),
              inert: false,
            },
          }),
        },
      ],
    });
    expect(routes["/partial"].inert).toBe(false);
    const server = createWebServer({ port: 0, native: { hostname: "127.0.0.1" }, routes });
    try {
      const rejected = await fetch(new URL("/partial", server.url), { method: "POST" });
      expect(rejected.status).toBe(403);
      expect(await rejected.json()).toEqual({ error: "Invalid or missing CSRF token." });
      const read = await fetch(new URL("/partial", server.url));
      expect(await read.text()).toBe("read");
      expect(read.headers.get("x-request-id")).toBeTruthy();
      const cookie = read.headers.getSetCookie()[0]?.split(";")[0] ?? "";
      const allowed = await fetch(new URL("/partial", server.url), {
        method: "POST",
        headers: {
          cookie,
          "x-csrf-token": decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)),
          origin: server.url.origin,
        },
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.text()).toBe("write");
      expect(allowed.headers.get("x-request-id")).toBeTruthy();
    } finally {
      await server.stop(true);
    }
  });

  test("static and mixed method values cannot bypass module middleware", async () => {
    const visits: string[] = [];
    const dependencies = createMockDependencies(new ServiceContainer());
    const moduleRoutes = buildModuleRoutes(dependencies, {
      modules: [
        {
          name: "native-values",
          routes: () => ({
            "/module": new Response("protected static"),
            "/mixed": { GET: new Response("protected method"), POST: () => new Response("write") },
          }),
        },
      ],
    });
    const routes = applyMiddlewareToRoutes(moduleRoutes, [
      async (request, next) => {
        visits.push(`${request.method} ${currentRequestMeta().routeTemplate}`);
        if (!request.headers.has("x-admitted")) return new Response("denied", { status: 403 });
        const response = await next();
        response.headers.set("x-module-middleware", "applied");
        return response;
      },
    ]);
    const server = createWebServer({ port: 0, native: { hostname: "127.0.0.1" }, routes });
    let csrfCookie = "";
    try {
      for (const [path, method, text] of [
        ["/module", "GET", "protected static"],
        ["/module", "POST", "protected static"],
        ["/mixed", "GET", "protected method"],
        ["/mixed", "POST", "write"],
      ] as const) {
        const rejected = await fetch(new URL(path, server.url), { method });
        expect(rejected.status).toBe(403);
        expect(await rejected.text()).toBe("denied");
        const admitted = await fetch(new URL(path, server.url), {
          method,
          headers: {
            "x-admitted": "1",
            cookie: csrfCookie,
            "x-csrf-token": decodeURIComponent(csrfCookie.slice(csrfCookie.indexOf("=") + 1)),
            origin: server.url.origin,
          },
        });
        csrfCookie = admitted.headers.getSetCookie()[0]?.split(";")[0] ?? csrfCookie;
        expect(admitted.headers.get("x-module-middleware")).toBe("applied");
        expect(await admitted.text()).toBe(text);
      }
      expect(visits).toEqual([
        "GET /module",
        "GET /module",
        "POST /module",
        "POST /module",
        "GET /mixed",
        "GET /mixed",
        "POST /mixed",
        "POST /mixed",
      ]);
    } finally {
      await server.stop(true);
    }
  });

  test("module middleware preserves required native callback arguments", async () => {
    const routes = applyMiddlewareToRoutes(
      {
        "/wrapped/:id": {
          GET: (request: BunRequest<"/wrapped/:id">, native?: Server<unknown>) =>
            Response.json({ id: request.params.id, port: native?.port }),
        },
      },
      [async (_request, next) => await next()],
    );
    const server = createWebServer({ port: 0, native: { hostname: "127.0.0.1" }, routes });
    try {
      expect(await (await fetch(new URL("/wrapped/12", server.url))).json()).toEqual({
        id: "12",
        port: server.port,
      });
    } finally {
      await server.stop(true);
    }
  });

  test("static responses support repeated native methods through request admission and CORS", async () => {
    const response = new Response("static body", { status: 201, headers: { "x-static": "yes" } });
    const seen: string[] = [];
    const server = createWebServer({
      port: 0,
      native: { hostname: "127.0.0.1" },
      routes: { "/static": response },
      onRequest(request) {
        seen.push(`${request.method} ${currentRequestMeta().routeTemplate}`);
        if (request.headers.has("x-reject")) return new Response("rejected", { status: 429 });
      },
    });
    try {
      for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "GET"]) {
        const result = await fetch(new URL("/static", server.url), { method });
        expect(result.status).toBe(201);
        expect(result.headers.get("x-static")).toBe("yes");
        expect(await result.text()).toBe(method === "HEAD" ? "" : "static body");
      }
      const rejected = await fetch(new URL("/static", server.url), {
        headers: { "x-reject": "1" },
      });
      expect(rejected.status).toBe(429);
      expect(await rejected.text()).toBe("rejected");
      const options = await fetch(new URL("/static", server.url), {
        method: "OPTIONS",
        headers: { origin: "https://client.example", "access-control-request-method": "POST" },
      });
      expect(options.status).toBe(204);
      expect(options.headers.get("access-control-allow-origin")).toBe("https://client.example");
      expect(seen).toEqual([
        "GET /static",
        "HEAD /static",
        "POST /static",
        "PUT /static",
        "DELETE /static",
        "PATCH /static",
        "GET /static",
        "GET /static",
        "OPTIONS /static",
      ]);
      expect(response.bodyUsed).toBe(false);
    } finally {
      await server.stop(true);
    }
  });

  test("method response values retain their method and explicit OPTIONS precedence", async () => {
    const server = createWebServer({
      port: 0,
      native: { hostname: "127.0.0.1" },
      routes: {
        "/method": {
          PATCH: new Response("patched", { status: 202 }),
          OPTIONS: new Response("explicit options", { status: 203 }),
        },
      },
    });
    try {
      for (let count = 0; count < 2; count++) {
        const response = await fetch(new URL("/method", server.url), { method: "PATCH" });
        expect(response.status).toBe(202);
        expect(await response.text()).toBe("patched");
      }
      const options = await fetch(new URL("/method", server.url), { method: "OPTIONS" });
      expect(options.status).toBe(203);
      expect(await options.text()).toBe("explicit options");
      expect((await fetch(new URL("/method", server.url))).status).toBe(404);
    } finally {
      await server.stop(true);
    }
  });

  test("shorthand and method callbacks receive the original native request and server", async () => {
    let admitted: Request | undefined;
    const handler = (request: BunRequest<"/things/:id">, native?: Server<unknown>) => {
      expect(admitted).toBe(request);
      return Response.json({
        id: request.params.id,
        port: native?.port,
        peer: native?.requestIP(request)?.address,
      });
    };
    const server = createWebServer({
      port: 0,
      native: { hostname: "127.0.0.1" },
      onRequest(request) {
        admitted = request;
      },
      routes: { "/things/:id": handler, "/posted/:id": { POST: handler } },
    });
    try {
      for (const [path, method] of [
        ["/things/12", "GET"],
        ["/posted/12", "POST"],
      ] as const) {
        expect(await (await fetch(new URL(path, server.url), { method })).json()).toEqual({
          id: "12",
          port: server.port,
          peer: "127.0.0.1",
        });
      }
    } finally {
      await server.stop(true);
    }
  });

  test("a static response admitted through an async request hook drains before infrastructure closes", async () => {
    const lifecycle = new LifecycleCoordinator({ timeoutMs: 2000 });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hookFinished = false;
    let closed = false;
    const server = createWebServer({
      port: 0,
      lifecycle,
      native: { hostname: "127.0.0.1" },
      routes: { "/static": new Response("drained") },
      async onRequest() {
        enter();
        await gate;
        hookFinished = true;
      },
    });
    lifecycle.register(
      "infrastructure",
      () => {
        expect(hookFinished).toBe(true);
        closed = true;
      },
      "close",
    );
    const result = fetch(new URL("/static", server.url));
    try {
      await entered;
      const shutdown = lifecycle.shutdown("DEPLOYMENT");
      await Bun.sleep(20);
      expect(closed).toBe(false);
      release();
      expect((await shutdown).successful).toBe(true);
      expect(await (await result).text()).toBe("drained");
      expect(closed).toBe(true);
    } finally {
      release();
      await server.stop(true);
    }
  });
});

test("public module route composition wraps actual native callbacks and static Responses without granting identity policy", async () => {
  const { createHttpKernel } = await import("@getstrata/bootstrap/httpKernel");
  const { runWithRequestMeta } = await import("@getstrata/core/http/requestMetaContext");
  const events: string[] = [];
  const phases: unknown[] = [];
  const base = createMockDependencies(new ServiceContainer());
  // Keep the generic invocation signature; record only its externally visible envelopes.
  const invoke: typeof base.invoke = (envelope, work) => {
    phases.push(envelope.metadata?.phase);
    return base.invoke(envelope, work);
  };
  const kernel = createHttpKernel({ ...base, invoke });
  await invoke({ kind: "command" }, (ports) =>
    ports.database.execute({ text: "CREATE TABLE static_privilege_rows (id INTEGER)", params: [] }),
  );
  const middleware: import("@getstrata/core/http/middleware").Middleware[] = [
    async (request, next) =>
      runWithRequestMeta({ ...currentRequestMeta(), userAgent: "module-owned" }, async () => {
        events.push("outer.before");
        const response = await next();
        expect(currentRequestMeta().userAgent).toBe("module-owned");
        events.push("outer.after");
        response.headers.set("x-module-outer", "applied");
        expect(request.url).toContain("/composed");
        return response;
      }),
    async (_request, next) => {
      events.push("inner.before");
      expect(currentRequestMeta().userAgent).toBe("module-owned");
      const response = await next();
      events.push("inner.after");
      return response;
    },
  ];
  const handler = async () => {
    events.push("handler");
    expect(currentRequestMeta().userAgent).toBe("module-owned");
    return new Response("native middleware", { status: 201 });
  };
  const wrapped = {
    ...kernel.wrapRouteMap({ "/composed": { GET: handler, inert: false } }, middleware),
    ...kernel.wrapRouteMap({ "/static": new Response("static response", { status: 202 }) }, []),
  };
  expect((wrapped["/composed"] as { inert: unknown }).inert).toBe(false);
  let policyAttempts = 0;
  let privilegedSQL = 0;
  const server = createWebServer({
    port: 0,
    native: { hostname: "127.0.0.1" },
    routes: wrapped as import("@getstrata/bootstrap/contracts").AppRouteMap,
    onRequest: async (request, _server, ports) => {
      if (new URL(request.url).pathname !== "/static") return;
      expect(ports).toBeDefined();
      if (!ports) throw new Error("Expected original business ports");
      policyAttempts++;
      await expect(
        (async () =>
          ports.policy.run(ports.database, { kind: "bypass" }, async (child) => {
            privilegedSQL++;
            await child.execute({
              text: "INSERT INTO static_privilege_rows VALUES (1)",
              params: [],
            });
            return undefined;
          }))(),
      ).rejects.toThrow("Database policy is not allowed by this route declaration.");
    },
  });
  try {
    const before = currentRequestMeta().userAgent;
    const response = await fetch(new URL("/composed", server.url));
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("native middleware");
    expect(response.headers.get("x-module-outer")).toBe("applied");
    expect(events).toEqual([
      "outer.before",
      "inner.before",
      "handler",
      "inner.after",
      "outer.after",
    ]);
    expect(currentRequestMeta().userAgent).toBe(before);
    // A separate empty middleware declaration keeps the static transport contract
    // observable without the /composed-only assertions above.
    events.length = 0;
    const staticResponse = await fetch(new URL("/static", server.url));
    expect(staticResponse.status).toBe(202);
    expect(await staticResponse.text()).toBe("static response");
    expect(policyAttempts).toBe(1);
    expect(privilegedSQL).toBe(0);
    expect(phases.filter(Boolean)).toEqual(["metadata", "business", "metadata", "business"]);
    expect(
      await invoke({ kind: "command" }, (ports) =>
        ports.database.execute({ text: "SELECT id FROM static_privilege_rows", params: [] }),
      ),
    ).toEqual([]);
  } finally {
    await server.stop(true);
    kernel.dispose();
  }
});
