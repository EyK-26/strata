import type { RegisteredRoute } from "@getstrata/core/openapi/registeredRoute";

class RouteRegistry {
  private readonly routes: RegisteredRoute[] = [];

  register(route: RegisteredRoute): void {
    this.routes.push(route);
  }

  clear(): void {
    this.routes.length = 0;
  }

  list(): RegisteredRoute[] {
    return [...this.routes].sort((left, right) => left.path.localeCompare(right.path));
  }
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
