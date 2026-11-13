import { expect, test } from "bun:test";
import {
  compileRouteMap,
  composeRouteMaps,
  getRouteInventory,
} from "@getstrata/bootstrap/routePlan";

test("route plans preserve plain handlers and normalize executable method maps", () => {
  const plain = () => Response.json({ plain: true });
  const methods = {
    get: () => new Response("read"),
    POST: () => new Response("write", { status: 201 }),
  };
  const middleware = ["global", "api"];
  const result = compileRouteMap(
    { "/plain": plain, "/methods": methods },
    {
      middleware,
      metadata: {
        "/plain": { GET: { summary: "Plain contract" } },
        "/methods": { GET: { summary: "Read contract" }, POST: { summary: "Write contract" } },
      },
    },
  );
  expect(result["/plain"]).toBe(plain);
  expect(result["/methods"]).toEqual({ GET: methods.get, POST: methods.POST });
  expect(Object.keys(methods)).toEqual(["get", "POST"]);
  expect(getRouteInventory(result)).toEqual([
    { method: "GET", path: "/methods", middleware, openApi: { summary: "Read contract" } },
    { method: "POST", path: "/methods", middleware, openApi: { summary: "Write contract" } },
    { method: "HEAD", path: "/methods", middleware },
    { method: "*", path: "/plain", middleware },
    { method: "GET", path: "/plain", middleware, openApi: { summary: "Plain contract" } },
  ]);
});

test("independent route maps cannot overwrite another application's metadata", () => {
  const first = compileRouteMap({ "/shared": () => new Response("one") }, { middleware: ["api"] });
  const before = getRouteInventory(first);
  const second = compileRouteMap(
    { "/shared": { GET: () => new Response("two") } },
    { middleware: ["web"] },
  );
  expect(getRouteInventory(first)).toBe(before);
  expect(getRouteInventory(second)).toEqual([
    { method: "GET", path: "/shared", middleware: ["web"] },
    { method: "HEAD", path: "/shared", middleware: ["web"] },
  ]);
  expect(() => composeRouteMaps(first, second)).toThrow("Duplicate route");
  expect(getRouteInventory(first)).toBe(before);
});

test("route plans lower static responses to supported methods", () => {
  const response = new Response("static");
  const result = compileRouteMap({ "/static": response }, { middleware: ["global"] });
  expect(Object.keys(result["/static"] as object)).toEqual([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS",
  ]);
  expect(getRouteInventory(result).map((route) => route.method)).toEqual([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS",
  ]);
});

test("route-plan metadata is hidden on an immutable owned map and input maps remain unmodified", () => {
  const input = { "/plain": () => new Response("ok") };
  const result = compileRouteMap(input);
  expect(Object.getOwnPropertySymbols(input)).toHaveLength(0);
  const symbols = Object.getOwnPropertySymbols(result);
  expect(symbols).toHaveLength(1);
  const [symbol] = symbols;
  if (!symbol) throw new Error("Missing route inventory symbol");
  const descriptor = Object.getOwnPropertyDescriptor(result, symbol);
  expect(descriptor?.enumerable).toBe(false);
  expect(descriptor?.writable).toBe(false);
  expect(descriptor?.configurable).toBe(false);
  expect(Object.keys(result)).toEqual(["/plain"]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(getRouteInventory(compileRouteMap(result))).toEqual(getRouteInventory(result));
  expect(() => compileRouteMap(result, { middleware: ["web"] })).toThrow("already compiled");
  expect(() =>
    compileRouteMap(result, { metadata: { "/plain": { GET: { summary: "replacement" } } } }),
  ).toThrow("already compiled");
});
