import type { RegisteredRoute } from "../core/openapi/registeredRoute";

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

const routeRegistry = new RouteRegistry();

export type { RegisteredRoute };
export { RouteRegistry, routeRegistry };
