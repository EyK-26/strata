import { applyMiddlewareToRoutes } from "@getstrata/core/http/middleware";
import type { OpenApiRouteMap } from "@getstrata/core/openapi/registeredRoute";
import { createCachedJson } from "./cachedJson";
import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { createHttpKernel } from "./httpKernel";
import { normalizeModuleResponseRoutes } from "./moduleResponseRoutes";
import { discoverModules } from "./modules";
import { prefixRouteMap } from "./prefixRouteMap";
import { registerOpenApiRouteMap } from "./routeMetadata";
import { routeRegistry } from "./routeRegistry";

interface BuildModuleRoutesOptions {
  apiPrefix?: string;
  modules?: AppModule[];
  clearRegistry?: boolean;
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
    normalizeModuleResponseRoutes(
      registerOpenApiRouteMap(
        prefixedModuleRoutes,
        ["global", "api"],
        prefixRouteMap(apiPrefix, metadata) as OpenApiRouteMap,
      ),
    ),
    middleware,
  ) as AppRouteMap;
}

export type { BuildModuleRoutesOptions };
export { buildModuleRoutes, registerOpenApiRouteMap };
