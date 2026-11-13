import type { OpenApiRouteMap, RegisteredRoute } from "@getstrata/core/openapi/registeredRoute";

const ROUTE_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const;
const OPENAPI_METHODS = new Set<string>([...ROUTE_METHODS, "TRACE"]);
// The symbol identifies a property on an owned route map. It holds no process-level state.
// Symbol.for preserves identity across independently bundled bootstrap entrypoints.
const inventoryKey = Symbol.for("@getstrata/owned-route-inventory");
function readRouteInventory(routes: object): readonly RegisteredRoute[] | undefined {
  return Object.getOwnPropertyDescriptor(routes, inventoryKey)?.value;
}

interface RouteSource {
  name: string;
  routes: Record<string, unknown>;
  metadata?: OpenApiRouteMap;
  middleware?: string[];
}
interface CompiledRoutePlan {
  routes: Record<string, unknown>;
  inventory: readonly RegisteredRoute[];
}

/** Copy diagnostics, rejecting executable/cyclic metadata before it reaches a registry. */
function immutableCopy<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value !== "object") {
    if (
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "bigint" ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new Error("Route metadata must contain only JSON values");
    }
    return value;
  }
  if (ancestors.has(value)) throw new Error("Route metadata must not contain cycles");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Error("Route metadata must contain only JSON objects");
  }
  ancestors.add(value);
  const copy = Array.isArray(value)
    ? value.map((entry) => immutableCopy(entry, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry, ancestors)]),
      );
  ancestors.delete(value);
  return Object.freeze(copy) as T;
}

function normalizeRoutePath(path: string, prefix = ""): string {
  const normalizedPrefix = prefix.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const result = `${normalizedPrefix ? (normalizedPrefix.startsWith("/") ? normalizedPrefix : `/${normalizedPrefix}`) : ""}${normalizedPath}`;
  if (
    !path ||
    /[?#\s]/.test(result) ||
    result.includes("//") ||
    result.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid route path: ${path}`);
  }
  return result;
}

function routeMethods(handler: unknown): { methods: string[]; handler: unknown } {
  if (handler === false) return { methods: [], handler };
  if (handler instanceof Response)
    return {
      methods: [...ROUTE_METHODS],
      handler: Object.freeze(Object.fromEntries(ROUTE_METHODS.map((method) => [method, handler]))),
    };
  if (typeof handler === "function") return { methods: ["*"], handler };
  if (handler && typeof handler === "object" && !Array.isArray(handler)) {
    const entries = Object.entries(handler);
    // Method maps normalize to executable uppercase keys; native values keep their transport semantics.
    if (
      entries.some(
        ([method, value]) =>
          OPENAPI_METHODS.has(method.toUpperCase()) ||
          typeof value === "function" ||
          value instanceof Response,
      )
    ) {
      const methods: Record<string, unknown> = {};
      for (const [rawMethod, value] of entries) {
        const method = rawMethod.toUpperCase();
        if (!ROUTE_METHODS.includes(method as (typeof ROUTE_METHODS)[number])) {
          throw new Error(`Unsupported route method: ${rawMethod}`);
        }
        if (Object.hasOwn(methods, method)) throw new Error(`Duplicate route method: ${method}`);
        if (typeof value !== "function" && !(value instanceof Response)) {
          throw new Error(`Invalid route handler: ${method}`);
        }
        methods[method] = value;
      }
      return { methods: Object.keys(methods), handler: Object.freeze(methods) };
    }
    if (Object.prototype.toString.call(handler) === "[object HTMLBundle]") {
      return { methods: ["GET", "HEAD"], handler };
    }
    if (handler instanceof Blob && "exists" in handler && typeof handler.exists === "function") {
      return { methods: ["*"], handler };
    }
    if (
      Object.getPrototypeOf(handler) === Object.prototype &&
      "dir" in handler &&
      typeof handler.dir === "string" &&
      handler.dir.length > 0 &&
      entries.every(
        ([key, value]) => key === "dir" || (key === "statCache" && typeof value === "boolean"),
      )
    ) {
      return { methods: ["*"], handler: Object.freeze({ ...handler }) };
    }
    throw new Error("Invalid route method map or native route declaration");
  }
  throw new Error("Invalid route handler");
}

/** A single validation pass shared by module builders and final route composition. */
function compileRoutePlan(sources: readonly RouteSource[], prefix = ""): CompiledRoutePlan {
  const routes: Record<string, unknown> = Object.create(null);
  const owners = new Map<string, Map<string, string>>();
  const inventory: RegisteredRoute[] = [];
  const canonicalPaths = new Map<string, string>();
  const implicitHeads = new Map<string, RegisteredRoute>();
  for (const source of sources) {
    for (const path of Object.keys(source.metadata ?? {})) {
      if (!Object.hasOwn(source.routes, path)) {
        throw new Error(`OpenAPI metadata has no API route: ${source.name} ${path}`);
      }
    }
    for (const [rawPath, rawHandler] of Object.entries(source.routes)) {
      const path = normalizeRoutePath(rawPath, prefix);
      const { methods, handler } = routeMethods(rawHandler);
      if (handler && typeof handler === "object" && "dir" in handler && !path.endsWith("/*")) {
        throw new Error(`Directory route must end in /*: ${path}`);
      }
      const collisionPath = path.replace(/:[^/]+/g, ":parameter");
      const canonicalPath = canonicalPaths.get(collisionPath);
      if (canonicalPath && canonicalPath !== path) {
        throw new Error(`Ambiguous route parameter names: ${canonicalPath} and ${path}`);
      }
      canonicalPaths.set(collisionPath, path);
      const previous = owners.get(collisionPath) ?? new Map<string, string>();
      for (const method of methods) {
        if (previous.has(method) || previous.has("*") || (method === "*" && previous.size)) {
          throw new Error(
            `Duplicate route: ${method} ${path} (${[...previous.values()][0]} and ${source.name})`,
          );
        }
      }
      const metadata = source.metadata?.[rawPath];
      for (const method of Object.keys(metadata ?? {})) {
        if (
          !OPENAPI_METHODS.has(method) ||
          (!methods.includes("*") &&
            !methods.includes(method) &&
            !(method === "HEAD" && methods.includes("GET")))
        ) {
          throw new Error(`OpenAPI metadata has no API handler: ${method} ${rawPath}`);
        }
      }
      // Preserve per-route middleware/contracts when an already compiled map is composed.
      const inherited = readRouteInventory(source.routes)?.filter(
        (entry) => entry.path === rawPath,
      );
      if (inherited) {
        inventory.push(
          ...inherited
            .filter(
              (entry) =>
                entry.method !== "HEAD" || !methods.includes("GET") || methods.includes("HEAD"),
            )
            .map((entry) => ({ ...entry, path })),
        );
      } else {
        for (const method of methods) {
          const openApi = metadata?.[method as keyof OpenApiRouteMap[string]];
          inventory.push({
            method,
            path,
            middleware: source.middleware ?? [],
            ...(openApi ? { openApi } : {}),
          });
        }
        if (methods.includes("*")) {
          for (const [method, openApi] of Object.entries(metadata ?? {})) {
            inventory.push({
              method,
              path,
              middleware: source.middleware ?? [],
              ...(openApi ? { openApi } : {}),
            });
          }
        }
      }
      if (methods.includes("GET") && !methods.includes("HEAD")) {
        const openApi =
          metadata?.HEAD ?? inherited?.find((entry) => entry.method === "HEAD")?.openApi;
        implicitHeads.set(path, {
          method: "HEAD",
          path,
          middleware:
            inherited?.find((entry) => entry.method === "GET")?.middleware ??
            source.middleware ??
            [],
          ...(openApi ? { openApi } : {}),
        });
      }
      for (const method of methods) previous.set(method, source.name);
      owners.set(collisionPath, previous);
      if (Object.hasOwn(routes, path)) {
        if (
          routes[path] === false ||
          handler === false ||
          Object.prototype.toString.call(routes[path]) === "[object HTMLBundle]" ||
          Object.prototype.toString.call(handler) === "[object HTMLBundle]"
        ) {
          throw new Error(`Cannot merge native bundle route: ${path}`);
        }
        routes[path] = Object.freeze({ ...(routes[path] as object), ...(handler as object) });
      } else {
        routes[path] = handler;
      }
    }
  }
  for (const [path, head] of implicitHeads) {
    if (!inventory.some((entry) => entry.path === path && entry.method === "HEAD"))
      inventory.push(head);
  }
  const snapshot = immutableCopy(
    inventory.sort((left, right) => left.path.localeCompare(right.path)),
  );
  return Object.freeze({ routes: attachRouteInventory(routes, snapshot), inventory: snapshot });
}

function attachRouteInventory(
  routes: Record<string, unknown>,
  inventory: readonly RegisteredRoute[],
): Record<string, unknown> {
  for (const value of Object.values(routes)) {
    if (
      value &&
      typeof value === "object" &&
      !(value instanceof Response) &&
      Object.keys(value).some((method) =>
        ROUTE_METHODS.includes(method as (typeof ROUTE_METHODS)[number]),
      )
    ) {
      Object.freeze(value);
    }
  }
  Object.defineProperty(routes, inventoryKey, { value: inventory, enumerable: false });
  return Object.freeze(routes);
}

function getRouteInventory(routes: Record<string, unknown>): readonly RegisteredRoute[] {
  const inventory = readRouteInventory(routes);
  if (!inventory) throw new Error("Route map has not been compiled");
  return inventory;
}

export type { CompiledRoutePlan, RouteSource };
export {
  attachRouteInventory,
  compileRoutePlan,
  getRouteInventory,
  immutableCopy,
  normalizeRoutePath,
};
