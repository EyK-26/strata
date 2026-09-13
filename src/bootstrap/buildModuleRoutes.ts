import { conditionalJsonResponse } from "@getstrata/core/http/conditionalResponse";
import { applyMiddlewareToRoutes } from "@getstrata/core/http/middleware";
import { createJsonErrorMiddleware } from "@getstrata/core/http/response";
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

function registerOpenApiRoute(method: string, path: string, middleware: string[]): void {
  routeRegistry.register({ method, path, middleware });
}

function registerOpenApiRouteMap(
  routes: Record<string, unknown>,
  middleware: string[],
): Record<string, unknown> {
  const registered: Record<string, unknown> = {};

  for (const [path, handler] of Object.entries(routes)) {
    if (handler && typeof handler === "object" && !Array.isArray(handler)) {
      const methodMap = handler as Record<string, unknown>;
      registered[path] = methodMap;

      for (const method of Object.keys(methodMap)) {
        registerOpenApiRoute(method.toUpperCase(), path, middleware);
      }
      continue;
    }

    registered[path] = handler;
    registerOpenApiRoute("GET", path, middleware);
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
  const middleware = [
    ...kernel.globalMiddleware(),
    createJsonErrorMiddleware(),
    ...kernel.group("api"),
  ];
  const cachedJson = createCachedJson(dependencies);
  const moduleRoutes: Record<string, unknown> = {};

  for (const module of modules) {
    if (!module.routes) {
      continue;
    }

    Object.assign(moduleRoutes, module.routes({ dependencies, cachedJson, kernel }));
  }

  const prefixedModuleRoutes = prefixRouteMap(apiPrefix, moduleRoutes);

  return applyMiddlewareToRoutes(
    registerOpenApiRouteMap(prefixedModuleRoutes, ["global", "api"]),
    middleware,
  ) as AppRouteMap;
}

export type { BuildModuleRoutesOptions };
export { buildModuleRoutes, registerOpenApiRouteMap };
