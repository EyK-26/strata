import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { convertAppRoutesToBunRoutes, createWebServer } from "@getstrata/bootstrap/web/server";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { generateOpenApiSpec } from "@getstrata/core/openapi/generator";
import { createMockDependencies } from "./testHelpers";

const keys = ["CORS_ALLOWED_ORIGINS", "CORS_ADDITIONAL_ALLOWED_HEADERS", "TENANCY_DRIVER"];
const previous = keys.map((key) => process.env[key]);
beforeEach(() => {
  process.env.CORS_ALLOWED_ORIGINS = "https://client.example";
  process.env.CORS_ADDITIONAL_ALLOWED_HEADERS = "Idempotency-Key";
  process.env.TENANCY_DRIVER = "none";
});
afterEach(() => {
  keys.forEach((key, index) => {
    const value = previous[index];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  routeRegistry.clear();
});
function preflight(origin = "https://client.example") {
  return {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,idempotency-key,x-unapproved",
    },
  };
}

describe("native registered-route preflights", () => {
  test("generated authenticated method maps admit approved preflights without executing business handlers", async () => {
    const dependencies = createMockDependencies(new ServiceContainer());
    dependencies.container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
    let writes = 0;
    const routes = buildModuleRoutes(dependencies, {
      modules: [
        {
          name: "payments",
          routes({ kernel }) {
            return {
              "/api/v1/orders": {
                POST: kernel.wrap("authenticated", async () => {
                  writes++;
                  return Response.json({ paid: false });
                }),
              },
            };
          },
        },
      ],
    });
    const server = createWebServer({ port: 0, routes });
    try {
      const url = `http://localhost:${server.port}/api/v1/orders`;
      const allowed = await fetch(url, preflight());
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://client.example");
      expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
      const headers =
        allowed.headers.get("access-control-allow-headers")?.toLowerCase().split(/,\s*/) ?? [];
      expect(headers).toContain("idempotency-key");
      expect(headers).toContain("authorization");
      expect(headers).not.toContain("x-unapproved");
      expect(writes).toBe(0);
      const rejected = await fetch(url, preflight("https://evil.example"));
      expect(rejected.status).toBe(204);
      expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
      expect(rejected.headers.get("access-control-allow-headers")).toBeNull();
      const actual = await fetch(url, {
        method: "POST",
        headers: { origin: "https://client.example", "Idempotency-Key": "fixture-key" },
      });
      expect(actual.status).toBe(403);
      expect(await actual.json()).toHaveProperty("error");
      expect(writes).toBe(0);
      const spec = generateOpenApiSpec(routeRegistry.list());
      expect(Object.keys(spec.paths["/api/v1/orders"] ?? {})).toEqual(["post"]);
      expect(routeRegistry.list().some((route) => route.method === "OPTIONS")).toBe(false);
      expect(routes["/api/v1/orders"]).not.toHaveProperty("OPTIONS");
      expect((await fetch(`http://localhost:${server.port}/unknown`, preflight())).status).toBe(
        404,
      );
    } finally {
      server.stop(true);
    }
  });

  test("GET shorthand, HEAD fallback and parameterized method maps retain native dispatch", async () => {
    let calls = 0;
    const server = createWebServer({
      port: 0,
      routes: {
        "/read": () => {
          calls++;
          return new Response("read");
        },
        "/things/:id": {
          PATCH: () => {
            calls++;
            return new Response(currentRequestMeta().routeTemplate);
          },
        },
      },
    });
    try {
      const url = `http://localhost:${server.port}`;
      for (const path of ["/read", "/things/123"]) {
        expect((await fetch(`${url}${path}`, preflight())).status).toBe(204);
      }
      expect(calls).toBe(0);
      expect(await (await fetch(`${url}/read`)).text()).toBe("read");
      const head = await fetch(`${url}/read`, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(await (await fetch(`${url}/things/123`, { method: "PATCH" })).text()).toBe(
        "/things/:id",
      );
    } finally {
      server.stop(true);
    }
  });

  test("explicit OPTIONS handlers take precedence and invalid route entries do not acquire handlers", async () => {
    const invalid = convertAppRoutesToBunRoutes({ "/empty": {}, "/metadata": { nope: false } });
    expect(Object.keys(invalid)).toEqual([]);
    const server = createWebServer({
      port: 0,
      routes: {
        "/explicit": {
          GET: () => new Response("get"),
          OPTIONS: () => new Response(currentRequestMeta().routeTemplate, { status: 202 }),
        },
      },
    });
    try {
      const response = await fetch(`http://localhost:${server.port}/explicit`, preflight());
      expect(response.status).toBe(202);
      expect(await response.text()).toBe("/explicit");
    } finally {
      server.stop(true);
    }
  });

  test("typed native server CORS options extend headers and invalid options fail before serving", async () => {
    expect(() =>
      createWebServer({
        port: 0,
        routes: { "/read": () => new Response("read") },
        cors: { additionalAllowedHeaders: ["*"] },
      }),
    ).toThrow(TypeError);
    const server = createWebServer({
      port: 0,
      routes: { "/read": () => new Response("read") },
      cors: { additionalAllowedHeaders: ["X-Native"] },
    });
    try {
      const response = await fetch(`http://localhost:${server.port}/read`, preflight());
      expect(response.headers.get("access-control-allow-headers")).toContain("X-Native");
      expect(response.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
    } finally {
      server.stop(true);
    }
  });
});
