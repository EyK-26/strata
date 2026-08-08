interface RegisteredRoute {
  method: string;
  path: string;
  middleware: string[];
}

class RouteRegistry {
  private readonly routes: RegisteredRoute[] = [];

  register(route: RegisteredRoute): void {
    this.routes.push(route);
  }

  list(): RegisteredRoute[] {
    return [...this.routes].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  }
}

const routeRegistry = new RouteRegistry();

export { RouteRegistry, routeRegistry };
export type { RegisteredRoute };
