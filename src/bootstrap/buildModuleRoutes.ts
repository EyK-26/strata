import { conditionalJsonResponse } from "@getstrata/core/http/conditionalResponse";
import { applyMiddlewareToRoutes } from "@getstrata/core/http/middleware";
import type { OpenApiOperation, OpenApiRouteMap } from "@getstrata/core/openapi/registeredRoute";
import type { AppDependencies, AppModule, AppRouteMap, CachedJson } from "./contracts";
import { createHttpKernel } from "./httpKernel";
import { discoverModules } from "./modules";
import { prefixRouteMap } from "./prefixRouteMap";
import { routeRegistry } from "./routeRegistry";

interface BuildModuleRoutesOptions {
  apiPrefix?: string;
  modules?: AppModule[];
  clearRegistry?: boolean;
}

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

function createCachedJson(dependencies: AppDependencies): CachedJson {
  return async <T>(
    cacheKey: string,
    loader: () => Promise<T>,
    tags: string[] = [],
    request?: Request,
  ): Promise<Response> => {
    const data =
      tags.length > 0
        ? await dependencies.cache.tags(...tags).remember(cacheKey, loader)
        : await dependencies.cache.remember(cacheKey, loader);

    return conditionalJsonResponse(request, data);
  };
}

function buildModuleRoutes(
  dependencies: AppDependencies,
  options: BuildModuleRoutesOptions = {},
): AppRouteMap {
  const { apiPrefix = "", modules = discoverModules(), clearRegistry = true } = options;

  if (clearRegistry) {
    routeRegistry.clear();
  }

  const kernel = createHttpKernel(dependencies);
  const middleware = [...kernel.globalMiddleware(), ...kernel.group("api")];
  const cachedJson = createCachedJson(dependencies);
  const moduleRoutes: Record<string, unknown> = {};
  const metadata: OpenApiRouteMap = {};

  for (const module of modules) {
    if (!module.routes) {
      continue;
    }

    const routes = module.routes({ dependencies, cachedJson, kernel });
    for (const [path, operations] of Object.entries(module.openApi ?? {})) {
      if (!(path in routes))
        throw new Error(`OpenAPI metadata has no API route: ${module.name} ${path}`);
      const methods =
        typeof routes[path] === "function"
          ? ["GET"]
          : Object.keys(routes[path] as object).map((method) => method.toUpperCase());
      for (const method of Object.keys(operations))
        if (!methods.includes(method))
          throw new Error(`OpenAPI metadata has no API handler: ${method} ${path}`);
    }
    for (const path of Object.keys(routes)) {
      delete metadata[path];
      if (module.openApi?.[path]) metadata[path] = module.openApi[path];
    }
    Object.assign(moduleRoutes, routes);
  }

  const prefixedModuleRoutes = prefixRouteMap(apiPrefix, moduleRoutes);

  return applyMiddlewareToRoutes(
    registerOpenApiRouteMap(
      prefixedModuleRoutes,
      ["global", "api"],
      prefixRouteMap(apiPrefix, metadata) as OpenApiRouteMap,
    ),
    middleware,
  ) as AppRouteMap;
}

export type { BuildModuleRoutesOptions };
export { buildModuleRoutes, registerOpenApiRouteMap };
