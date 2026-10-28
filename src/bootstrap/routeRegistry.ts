import type { RegisteredRoute } from "@getstrata/core/openapi/registeredRoute";

class RouteRegistry {
  private readonly routes: RegisteredRoute[] = [];
  private revision = 0;

  register(route: RegisteredRoute): void {
    this.revision++;
    this.routes.push(route);
  }

  clear(): void {
    this.revision++;
    this.routes.length = 0;
  }

  list(): RegisteredRoute[] {
    return [...this.routes].sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Opt-in prototype: preserve registry identity and hooks; external hook effects
   * cannot be rolled back. Own rows are copied before any mutation occurs. */
  installSnapshot(next: readonly RegisteredRoute[]): { restore(): boolean } {
    const before = snapshotRouteData(this.routes) as RegisteredRoute[];
    const candidate = snapshotRouteData(next) as RegisteredRoute[];
    try {
      this.clear();
      for (const route of candidate) this.register(route);
      if (
        this.routes.length !== candidate.length ||
        this.routes.some((route, index) => route !== candidate[index])
      )
        throw new TypeError("Metadata hooks changed candidate rows during installation.");
    } catch (error) {
      this.routes.splice(0, this.routes.length, ...before);
      this.revision++;
      throw error;
    }
    const installed = this.revision;
    return Object.freeze({
      restore: () => {
        if (this.revision !== installed) return false;
        this.routes.splice(0, this.routes.length, ...before);
        this.revision++;
        return true;
      },
    });
  }
}

export function snapshotRouteData(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  )
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || depth > 50 || ancestors.has(value))
    throw new TypeError("Route metadata must contain bounded plain data.");
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) &&
    Object.getPrototypeOf(value) !== null
  )
    throw new TypeError("Route metadata must contain plain data.");
  ancestors.add(value);
  const copy: Record<string, unknown> = array
    ? (new Array((value as unknown[]).length) as unknown as Record<string, unknown>)
    : Object.create(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      throw new TypeError("Route metadata accessors and symbols are unsupported.");
    Object.defineProperty(copy, key, {
      value: snapshotRouteData(descriptor.value, ancestors, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  ancestors.delete(value);
  return Object.freeze(copy);
}

const ROUTE_REGISTRY_KEY = Symbol.for("@getstrata/routeRegistry");

function readSharedRouteRegistry(): RouteRegistry {
  const globalRegistry = (globalThis as Record<symbol, RouteRegistry | undefined>)[
    ROUTE_REGISTRY_KEY
  ];

  if (globalRegistry) {
    return globalRegistry;
  }

  const registry = new RouteRegistry();
  (globalThis as Record<symbol, RouteRegistry>)[ROUTE_REGISTRY_KEY] = registry;
  return registry;
}

const routeRegistry = readSharedRouteRegistry();

export type { RegisteredRoute };
export { RouteRegistry, routeRegistry };
