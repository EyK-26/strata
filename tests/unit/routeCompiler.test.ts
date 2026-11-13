import { expect, test } from "bun:test";
import { compileRoutePlan, getRouteInventory } from "../../src/bootstrap/routeCompiler";
import { publishRoutePlan } from "../../src/bootstrap/routeMetadata";
import { generateOpenApiSpec } from "../../src/core/openapi/generator";
import { validateOpenApiSpec } from "../../src/core/openapi/validate";

const handler = () => new Response("ok");

test("normalizes prefix, path and methods and merges disjoint operations in declaration order", () => {
  const plan = compileRoutePlan(
    [
      {
        name: "read",
        routes: { items: { get: handler } },
        metadata: { items: { GET: { summary: "Read" } } },
      },
      { name: "write", routes: { "/items": { post: handler } } },
    ],
    "api/",
  );
  expect(Object.keys(plan.routes)).toEqual(["/api/items"]);
  expect(Object.keys(plan.routes["/api/items"] as object)).toEqual(["GET", "POST"]);
  expect(plan.inventory.map(({ method }) => method)).toEqual(["GET", "POST", "HEAD"]);
});

test("rejects duplicate aliases, method aliases, parameter shapes, invalid handlers and orphan metadata before publication", () => {
  const published = publishRoutePlan(
    compileRoutePlan([{ name: "existing", routes: { "/kept": handler } }]),
  );
  const before = getRouteInventory(published);
  for (const sources of [
    [{ name: "duplicate", routes: { items: handler, "/items": handler } }],
    [{ name: "duplicate method", routes: { "/items": { get: handler, GET: handler } } }],
    [
      {
        name: "aliases",
        routes: { "/items/:id": { GET: handler }, "/items/:name": { POST: handler } },
      },
    ],
    [{ name: "bad method", routes: { "/items": { BANANA: handler } } }],
    [{ name: "bad handler", routes: { "/items": { POST: "invalid" } } }],
    [{ name: "empty", routes: { "/items": {} } }],
    [{ name: "date", routes: { "/items": new Date() } }],
    [{ name: "map", routes: { "/items": new Map() } }],
    [{ name: "directory path", routes: { "/items": { dir: "." } } }],
    [{ name: "directory options", routes: { "/items/*": { dir: ".", invalid: true } } }],
    [{ name: "orphan path", routes: {}, metadata: { "/missing": { GET: {} } } }],
    [
      {
        name: "orphan method",
        routes: { "/items": { POST: handler } },
        metadata: { "/items": { GET: {} } },
      },
    ],
  ]) {
    expect(() => publishRoutePlan(compileRoutePlan(sources))).toThrow();
    expect(getRouteInventory(published)).toEqual(before);
  }
});

test("copies and deeply freezes inventory without freezing caller-owned metadata", () => {
  const schema = { type: "object", properties: { id: { type: "integer" } } };
  const metadata = {
    "/items": {
      POST: {
        tags: ["items"],
        responses: { "200": { description: "OK", content: { "application/json": { schema } } } },
      },
    },
  };
  const middleware = ["global", "api"];
  const plan = compileRoutePlan([
    { name: "items", routes: { "/items": { POST: handler } }, metadata, middleware },
  ]);
  publishRoutePlan(plan);
  schema.properties.id.type = "string";
  middleware.push("changed");
  metadata["/items"].POST.tags.push("changed");
  expect(plan.inventory[0]?.middleware).toEqual(["global", "api"]);
  expect(plan.inventory[0]?.openApi?.tags).toEqual(["items"]);
  const storedSchema =
    plan.inventory[0]?.openApi?.responses?.["200"]?.content?.["application/json"]?.schema;
  expect(storedSchema).toEqual({ type: "object", properties: { id: { type: "integer" } } });
  expect(Object.isFrozen(storedSchema)).toBe(true);
  expect(Object.isFrozen(plan.inventory)).toBe(true);
  expect(Object.isFrozen(plan.inventory[0]?.openApi?.tags)).toBe(true);
  expect(Object.isFrozen(getRouteInventory(plan.routes)[0]?.middleware)).toBe(true);
  expect(Object.isFrozen(plan.routes["/items"])).toBe(true);
});

test("rejects executable and cyclic metadata", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const schema of [{ default: () => {} }, cycle]) {
    expect(() =>
      compileRoutePlan([
        {
          name: "bad",
          routes: { "/items": handler },
          metadata: {
            "/items": {
              GET: {
                responses: {
                  "200": {
                    description: "OK",
                    content: { "application/json": { schema: schema as never } },
                  },
                },
              },
            },
          },
        },
      ]),
    ).toThrow("metadata");
  }
});

test("composing compiled maps preserves per-operation middleware, contracts and explicit HEAD override", () => {
  const read = compileRoutePlan([
    {
      name: "read",
      routes: { "/items": { GET: handler } },
      middleware: ["global", "api"],
      metadata: { "/items": { GET: { operationId: "readItems" } } },
    },
  ]);
  const head = compileRoutePlan([
    { name: "head", routes: { "/items": { HEAD: handler } }, middleware: ["global", "web"] },
  ]);
  const combined = compileRoutePlan([
    { name: "read", routes: read.routes },
    { name: "head", routes: head.routes },
  ]);
  expect(combined.inventory).toEqual([
    {
      method: "GET",
      path: "/items",
      middleware: ["global", "api"],
      openApi: { operationId: "readItems" },
    },
    { method: "HEAD", path: "/items", middleware: ["global", "web"] },
  ]);
  expect(getRouteInventory(combined.routes)).toBe(combined.inventory);
});

test("wildcard inventory generates standard OpenAPI operations and attaches contracts only to their declared methods", () => {
  const plan = compileRoutePlan([
    {
      name: "wildcard",
      routes: { "/items": handler },
      metadata: { "/items": { GET: { operationId: "readItems", summary: "Read items" } } },
    },
  ]);
  expect(plan.inventory.map(({ method }) => method)).toEqual(["*", "GET"]);
  const spec = generateOpenApiSpec([...plan.inventory]);
  expect(Object.keys(spec.paths["/items"] ?? {})).toEqual([
    "get",
    "head",
    "post",
    "put",
    "delete",
    "patch",
    "options",
    "trace",
  ]);
  expect(spec.paths["/items"]?.get).toMatchObject({
    operationId: "readItems",
    summary: "Read items",
  });
  expect(spec.paths["/items"]?.post).not.toHaveProperty("operationId");
  expect(validateOpenApiSpec(spec)).toEqual([]);
});

test("compiled inventory matches real Bun wildcard, GET/HEAD and static-response method dispatch", async () => {
  const plan = compileRoutePlan([
    {
      name: "actual",
      routes: {
        "/wildcard": handler,
        "/read": { GET: handler },
        "/static": new Response("static"),
      },
    },
  ]);
  const server = Bun.serve({
    port: 0,
    routes: plan.routes as never,
    fetch: () => new Response("missing", { status: 404 }),
  });
  try {
    for (const [path, method, status] of [
      ["/wildcard", "TRACE", 200],
      ["/wildcard", "POST", 200],
      ["/read", "GET", 200],
      ["/read", "HEAD", 200],
      ["/read", "OPTIONS", 404],
      ["/read", "POST", 404],
      ["/static", "GET", 200],
      ["/static", "POST", 200],
      ["/static", "TRACE", 404],
    ] as const) {
      expect((await fetch(new URL(path, server.url), { method })).status).toBe(status);
      const represented = plan.inventory.some(
        (entry) => entry.path === path && (entry.method === method || entry.method === "*"),
      );
      expect(represented).toBe(status === 200);
    }
  } finally {
    server.stop(true);
  }
});

test("native directory options are copied and frozen, disabled routes have no inventory", () => {
  const directory = { dir: ".", statCache: false };
  const plan = compileRoutePlan([
    { name: "native", routes: { "/public/*": directory, "/disabled": false } },
  ]);
  directory.dir = "/changed";
  directory.statCache = true;
  expect(plan.routes["/public/*"]).toEqual({ dir: ".", statCache: false });
  expect(Object.isFrozen(plan.routes["/public/*"])).toBe(true);
  expect(plan.inventory).toEqual([{ method: "*", path: "/public/*", middleware: [] }]);
  expect(() =>
    compileRoutePlan([
      { name: "one", routes: { "/disabled": false } },
      { name: "two", routes: { "/disabled": handler } },
    ]),
  ).toThrow("Cannot merge");
});

test("rejects malformed paths, primitive handlers and non-JSON metadata objects", () => {
  for (const path of ["", "/bad?query", "/bad//path", "/bad/../path"]) {
    expect(() => compileRoutePlan([{ name: "bad", routes: { [path]: handler } }])).toThrow(
      "Invalid route path",
    );
  }
  expect(() => compileRoutePlan([{ name: "bad", routes: { "/bad": "bad" } }])).toThrow(
    "Invalid route handler",
  );
  expect(() =>
    compileRoutePlan([
      {
        name: "bad",
        routes: { "/bad": handler },
        metadata: {
          "/bad": {
            GET: {
              responses: {
                "200": {
                  description: "Bad",
                  content: { "application/json": { schema: new Date() as never } },
                },
              },
            },
          },
        },
      },
    ]),
  ).toThrow("JSON objects");
  expect(() => getRouteInventory({})).toThrow("not been compiled");
});

test("native HTML bundles retain GET/HEAD coverage and native Bun files retain wildcard coverage", async () => {
  const { default: index } = await import("../../index.html");
  const file = Bun.file(new URL("../../index.html", import.meta.url));
  const plan = compileRoutePlan([{ name: "native", routes: { "/bundle": index, "/file": file } }]);
  expect(plan.routes["/bundle"]).toBe(index);
  expect(plan.routes["/file"]).toBe(file);
  expect(plan.inventory).toEqual([
    { method: "GET", path: "/bundle", middleware: [] },
    { method: "HEAD", path: "/bundle", middleware: [] },
    { method: "*", path: "/file", middleware: [] },
  ]);
  expect(() =>
    compileRoutePlan([
      { name: "bundle", routes: { "/bundle": index } },
      { name: "method", routes: { "/bundle": { POST: handler } } },
    ]),
  ).toThrow("Cannot merge native");
  const server = Bun.serve({ port: 0, routes: plan.routes as never });
  try {
    for (const [path, method, status] of [
      ["/bundle", "GET", 200],
      ["/bundle", "HEAD", 200],
      ["/bundle", "POST", 405],
      ["/file", "TRACE", 200],
    ] as const) {
      const response = await fetch(new URL(path, server.url), { method });
      expect(response.status).toBe(status);
      await response.arrayBuffer();
    }
  } finally {
    server.stop(true);
  }
});
