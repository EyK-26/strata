import { expect, test } from "bun:test";
import {
  defineApplicationRoutes,
  routeShape,
  validateGuardedRoutes,
} from "../../src/bootstrap/m1/guardedRoutes";
import { RouteRegistry, snapshotRouteData } from "../../src/bootstrap/routeRegistry";

test("strict declarations preserve spelling and use matching shapes only for ownership", () => {
  expect(routeShape("/notes/:id")).toBe("/notes/:");
  expect(routeShape("/notes/:slug")).toBe("/notes/:");
  expect(routeShape("/notes/*")).toBe("/notes/*");
  expect(routeShape("/")).toBe("/");
  expect(routeShape("/trail/")).toBe("/trail/");
  expect(routeShape("/Case")).not.toBe(routeShape("/case"));
});
for (const path of [
  "",
  "alias",
  "/a//b",
  "/a/../b",
  "/a/./b",
  "/a?b",
  "/a#b",
  "/a\\b",
  "/a%2Fb",
  "/é",
  "/a/*/b",
  "/:id/:id",
  "/:invalid-name",
  "/ ",
]) {
  test(`strict path rejects ${JSON.stringify(path)}`, () => {
    expect(() => routeShape(path)).toThrow();
  });
}
test("native Response/method values and callbacks become copied nonempty SDK maps", async () => {
  let calls = 0;
  const input = {
    "/callback": () => {
      calls++;
      return new Response("callback");
    },
    "/static": new Response("static"),
    "/explicit": { HEAD: new Response("head"), OPTIONS: () => new Response(null, { status: 202 }) },
  };
  const result = defineApplicationRoutes()(input);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.keys(result["/static"])).toEqual(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
  expect(calls).toBe(0);
  const method = result["/callback"] as unknown as {
    GET(request: Request, server: unknown): Promise<Response>;
  };
  expect(await (await method.GET(new Request("http://localhost"), undefined)).text()).toBe(
    "callback",
  );
  expect(calls).toBe(1);
});
for (const value of [
  false,
  null,
  undefined,
  "file",
  Bun.file("not-a-route"),
  {},
  [],
  { get: () => new Response() },
  { GET: undefined },
  { GET: false },
  { CONNECT: () => new Response() },
]) {
  test(`rejects unsupported route value ${String(value)}`, () => {
    expect(() => validateGuardedRoutes({ "/bad": value }, "fixture")).toThrow();
  });
}
test("does not execute route or method accessors; rejects consumed Responses", async () => {
  let reads = 0;
  const routes = Object.defineProperty({}, "/bad", {
    enumerable: true,
    get() {
      reads++;
      return new Response();
    },
  });
  expect(() => validateGuardedRoutes(routes, "fixture")).toThrow();
  const methods = Object.defineProperty({}, "GET", {
    enumerable: true,
    get() {
      reads++;
      return () => new Response();
    },
  });
  expect(() => validateGuardedRoutes({ "/bad": methods }, "fixture")).toThrow();
  expect(reads).toBe(0);
  const used = new Response("used");
  await used.text();
  expect(() => validateGuardedRoutes({ "/bad": used }, "fixture")).toThrow();
});
test("invalid JavaScript handler returns reject at the existing request boundary", async () => {
  const result = validateGuardedRoutes({ "/bad": () => undefined }, "fixture") as unknown as {
    "/bad": { GET(request: Request, server: unknown): Promise<Response> };
  };
  await expect(result["/bad"].GET(new Request("http://localhost"), undefined)).rejects.toThrow(
    "invalid-handler-return",
  );
});
test("registry snapshots preserve identity/hooks, isolate nested data and guard restore ownership", () => {
  class ObservedRegistry extends RouteRegistry {
    events: string[] = [];
    override register(route: Parameters<RouteRegistry["register"]>[0]) {
      this.events.push(route.path);
      super.register(route);
    }
  }
  const registry = new ObservedRegistry();
  const original = { method: "GET", path: "/before", middleware: ["original"] };
  registry.register(original);
  const candidate = { method: "GET", path: "/after", middleware: ["candidate"] };
  const lease = registry.installSnapshot([candidate]);
  candidate.middleware.push("mutated");
  original.middleware.push("mutated");
  expect(registry.list()[0]?.middleware).toEqual(["candidate"]);
  expect(registry.events).toEqual(["/before", "/after"]);
  expect(lease.restore()).toBe(true);
  expect(lease.restore()).toBe(false);
  expect(registry.list()[0]?.middleware).toEqual(["original"]);
  expect(Object.getPrototypeOf(registry.list()[0])).toBe(Object.prototype);
  const other = registry.installSnapshot([candidate]);
  registry.register({ method: "GET", path: "/foreign", middleware: [] });
  expect(other.restore()).toBe(false);
  expect(registry.list().some((row) => row.path === "/foreign")).toBe(true);
});
test("metadata accessors/cycles are rejected before mutation; hook rejection restores own rows", () => {
  const registry = new RouteRegistry();
  registry.register({ method: "GET", path: "/before", middleware: [] });
  let reads = 0;
  const getter = Object.defineProperty({}, "summary", {
    enumerable: true,
    get() {
      reads++;
      return "unsafe";
    },
  });
  expect(() =>
    registry.installSnapshot([{ method: "GET", path: "/bad", middleware: [], openApi: getter }]),
  ).toThrow();
  expect(reads).toBe(0);
  expect(registry.list()[0]?.path).toBe("/before");
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() =>
    registry.installSnapshot([{ method: "GET", path: "/bad", middleware: [], openApi: cyclic }]),
  ).toThrow();
  class RejectingRegistry extends RouteRegistry {
    override register(route: Parameters<RouteRegistry["register"]>[0]) {
      if (route.path === "/reject") throw new Error("hook rejected");
      super.register(route);
    }
  }
  const rejecting = new RejectingRegistry();
  rejecting.register({ method: "GET", path: "/before", middleware: [] });
  expect(() =>
    rejecting.installSnapshot([{ method: "GET", path: "/reject", middleware: [] }]),
  ).toThrow("hook rejected");
  expect(rejecting.list()[0]?.path).toBe("/before");
});

test("a registry extension cannot append unvalidated rows during snapshot installation", () => {
  class ReentrantRegistry extends RouteRegistry {
    override register(route: Parameters<RouteRegistry["register"]>[0]) {
      super.register(route);
      if (route.path === "/candidate")
        super.register({ method: "GET", path: "/unvalidated", middleware: [] });
    }
  }
  const registry = new ReentrantRegistry();
  registry.register({ method: "GET", path: "/baseline", middleware: [] });
  expect(() =>
    registry.installSnapshot([{ method: "GET", path: "/candidate", middleware: [] }]),
  ).toThrow("changed candidate");
  expect(registry.list().map((row) => row.path)).toEqual(["/baseline"]);
});

test("metadata snapshots preserve plain prototypes without invoking the __proto__ setter", () => {
  const input = JSON.parse('{"__proto__":{"owned":true},"summary":"safe"}');
  const result = snapshotRouteData(input) as Record<string, unknown>;
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.hasOwn(result, "__proto__")).toBe(true);
  expect((result as { owned?: boolean }).owned).toBeUndefined();
  expect(result.__proto__).toEqual({ owned: true });
  const dictionary = Object.assign(Object.create(null), { value: "plain" });
  expect(Object.getPrototypeOf(snapshotRouteData(dictionary))).toBeNull();
});
