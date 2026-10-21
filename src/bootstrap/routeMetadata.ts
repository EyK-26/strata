import type { OpenApiOperation, OpenApiRouteMap } from "@getstrata/core/openapi/registeredRoute";
import { routeRegistry } from "./routeRegistry";

function registerOpenApiRoute(
  method: string,
  path: string,
  middleware: string[],
  openApi?: OpenApiOperation,
): void {
  routeRegistry.register({ method, path, middleware, ...(openApi ? { openApi } : {}) });
}

function registerOpenApiRouteMap(
  routes: Record<string, unknown>,
  middleware: string[],
  metadata: OpenApiRouteMap = {},
): Record<string, unknown> {
  const registered: Record<string, unknown> = {};

  for (const [path, handler] of Object.entries(routes)) {
    if (handler && typeof handler === "object" && !Array.isArray(handler)) {
      const methodMap = handler as Record<string, unknown>;
      registered[path] = methodMap;

      for (const method of Object.keys(methodMap)) {
        registerOpenApiRoute(
          method.toUpperCase(),
          path,
          middleware,
          metadata[path]?.[method.toUpperCase() as keyof OpenApiRouteMap[string]],
        );
      }
      continue;
    }

    registered[path] = handler;
    registerOpenApiRoute("GET", path, middleware, metadata[path]?.GET);
  }

  return registered;
}

export { registerOpenApiRouteMap };
