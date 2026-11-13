import { afterEach, expect, test } from "bun:test";
import { registerOpenApiRouteMap } from "@getstrata/bootstrap/buildModuleRoutes";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { registerOpenApiRouteMap as internalRegistration } from "../../src/bootstrap/routeMetadata";

afterEach(() => routeRegistry.clear());

test("metadata registration preserves plain handlers and normalizes executable method maps", () => {
  const plain = () => Response.json({ plain: true });
  const methods = {
    get: () => new Response("read"),
    POST: () => new Response("write", { status: 201 }),
  };
  const middleware = ["global", "api"];
  const result = registerOpenApiRouteMap({ "/plain": plain, "/methods": methods }, middleware, {
    "/plain": { GET: { summary: "Plain contract" } },
    "/methods": { GET: { summary: "Read contract" }, POST: { summary: "Write contract" } },
  });
  expect(result["/plain"]).toBe(plain);
  expect(result["/methods"]).toEqual({ GET: methods.get, POST: methods.POST });
  expect(Object.keys(methods)).toEqual(["get", "POST"]);
  expect(routeRegistry.list()).toEqual([
    { method: "GET", path: "/methods", middleware, openApi: { summary: "Read contract" } },
    { method: "POST", path: "/methods", middleware, openApi: { summary: "Write contract" } },
    { method: "HEAD", path: "/methods", middleware },
    { method: "*", path: "/plain", middleware },
    { method: "GET", path: "/plain", middleware, openApi: { summary: "Plain contract" } },
  ]);
});

test("metadata registration appends with no implicit registry clearing or fabricated metadata", () => {
  registerOpenApiRouteMap({ "/first": () => new Response() }, ["global", "api"]);
  registerOpenApiRouteMap({ "/second": { GET: () => new Response() } }, ["global", "web"]);
  expect(routeRegistry.list()).toEqual([
    { method: "*", path: "/first", middleware: ["global", "api"] },
    { method: "GET", path: "/second", middleware: ["global", "web"] },
    { method: "HEAD", path: "/second", middleware: ["global", "web"] },
  ]);
});

test("metadata registration lowers static responses to the supported explicit methods", () => {
  const response = new Response("static");
  const result = registerOpenApiRouteMap({ "/static": response }, ["global"]);
  expect(Object.keys(result["/static"] as object)).toEqual([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS",
  ]);
  expect(routeRegistry.list().map((route) => route.method)).toEqual([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS",
  ]);
});

test("the existing API builder export retains the shared metadata function identity", () => {
  expect(registerOpenApiRouteMap).toBe(internalRegistration);
});
