import { expect, test } from "bun:test";
import { registerOpenApiRouteMap } from "@getstrata/bootstrap/buildModuleRoutes";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { mergeRouteMaps, type RouteRequest, resourceRoutes } from "@getstrata/core/http/route";
import { generateOpenApiSpec } from "@getstrata/core/openapi/generator";

test("resources expand only supplied actions, preserving handler identity", () => {
  const collection = () => new Response("collection");
  const member = (request: RouteRequest<{ id: string }>) => new Response(request.params.id);
  const routes = resourceRoutes("/admin/orders", {
    index: collection,
    create: collection,
    store: collection,
    show: member,
    edit: member,
    update: member,
    destroy: member,
  });
  expect(routes).toEqual({
    "/admin/orders": { GET: collection, POST: collection },
    "/admin/orders/create": { GET: collection },
    "/admin/orders/:id": { GET: member, PUT: member, PATCH: member, DELETE: member },
    "/admin/orders/:id/edit": { GET: member },
  });
  expect(resourceRoutes("/orders", { show: member })).toEqual({ "/orders/:id": { GET: member } });
  expect(resourceRoutes("/orders", {})).toEqual({});
  for (const path of [
    "",
    "/",
    "orders",
    "/orders/",
    "/orders/:id",
    "/orders?x=1",
    "/orders/*",
    "/../orders",
    "/orders/.",
  ])
    expect(() => resourceRoutes(path, {})).toThrow(TypeError);
  expect(() => resourceRoutes("/orders", JSON.parse('{"unknown": null}'))).toThrow(
    "Invalid resource action",
  );
  expect(() => resourceRoutes("/orders", JSON.parse('{"show": null}'))).toThrow(
    "Invalid resource action",
  );
});

test("strict composition does not mutate inputs or silently replace paths", () => {
  const get = () => new Response("ok");
  const resource = resourceRoutes("/orders", { index: get });
  const custom = { "/orders/report": { GET: get } };
  expect(mergeRouteMaps(resource, custom)).toEqual({ ...resource, ...custom });
  expect(resource).not.toHaveProperty("/orders/report");
  expect(() => mergeRouteMaps(resource, { "/orders": { POST: get } })).toThrow(
    "Duplicate route path: /orders",
  );
  expect(mergeRouteMaps()).toEqual({});
});

test("native Bun resource dispatch preserves methods, static precedence and typed middleware parameters", async () => {
  const secured = composeMiddleware(async (request, next) =>
    request.headers.get("x-fixture-auth") === "yes"
      ? next()
      : new Response("Denied", { status: 403 }),
  );
  const member = secured((request: RouteRequest<{ id: string }>) =>
    Response.json({ id: request.params.id, method: request.method }),
  );
  const routes = resourceRoutes("/orders", {
    index: () => new Response("index"),
    create: () => new Response("create"),
    store: () => new Response("stored", { status: 201 }),
    show: member,
    edit: member,
    update: member,
    destroy: member,
  });
  const server = Bun.serve({
    port: 0,
    routes,
    fetch: () => new Response("Missing", { status: 404 }),
  });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    expect(await (await fetch(`${origin}/orders/create`)).text()).toBe("create");
    expect((await fetch(`${origin}/orders`, { method: "POST" })).status).toBe(201);
    expect((await fetch(`${origin}/orders/12`)).status).toBe(403);
    for (const [path, method] of [
      ["/orders/12", "GET"],
      ["/orders/12/edit", "GET"],
      ["/orders/12", "PUT"],
      ["/orders/12", "PATCH"],
      ["/orders/12", "DELETE"],
    ]) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: { "x-fixture-auth": "yes" },
      });
      expect(await response.json()).toEqual({ id: "12", method });
    }
    expect(
      (await fetch(`${origin}/orders/12/edit`, { method: "POST" })).status,
    ).toBeGreaterThanOrEqual(400);
  } finally {
    server.stop(true);
  }
});

test("expanded API resource routes retain explicit operation metadata", () => {
  routeRegistry.clear();
  try {
    const routes = resourceRoutes("/api/orders", {
      index: () => Response.json([]),
      show: (request) => Response.json({ id: request.params.id }),
    });
    registerOpenApiRouteMap(routes, ["api"], {
      "/api/orders/:id": { GET: { summary: "Read order" } },
    });
    const spec = generateOpenApiSpec(routeRegistry.list());
    expect(spec.paths["/api/orders/{id}"]?.get).toMatchObject({ summary: "Read order" });
    expect(Object.keys(spec.paths)).toHaveLength(2);
  } finally {
    routeRegistry.clear();
  }
});
