import type { OpenApiRouteMap } from "@getstrata/core/openapi/registeredRoute";
import { createCachedJson } from "./cachedJson";
import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { createHttpKernel } from "./httpKernel";
import { applyModuleRouteMiddleware } from "./moduleRouteMiddleware";
import { discoverModules } from "./modules";
import { prefixRouteMap } from "./prefixRouteMap";
import { registerOpenApiRouteMap } from "./routeMetadata";
import { type RouteRegistry, routeRegistry } from "./routeRegistry";

interface BuildModuleRoutesOptions {
  apiPrefix?: string;
  modules?: AppModule[];
  clearRegistry?: boolean;
  registry?: RouteRegistry;
}

/** Prefix handlers and their own contracts together so normalized aliases share one winner. */
function prefixApiModuleRoutes(
  prefix: string,
  routes: Record<string, unknown>,
  metadata: OpenApiRouteMap,
): { routes: Record<string, unknown>; metadata: OpenApiRouteMap } {
  const entries = Object.fromEntries(
    Object.entries(routes).map(([path, handler]) => [path, { handler, openApi: metadata[path] }]),
  );
  const prefixedRoutes: Record<string, unknown> = {};
  const prefixedMetadata: OpenApiRouteMap = {};
  for (const [path, entry] of Object.entries(prefixRouteMap(prefix, entries))) {
    prefixedRoutes[path] = entry.handler;
    if (entry.openApi) prefixedMetadata[path] = entry.openApi;
  }
  return { routes: prefixedRoutes, metadata: prefixedMetadata };
}

function buildModuleRoutes(
  dependencies: AppDependencies,
  options: BuildModuleRoutesOptions = {},
): AppRouteMap {
  const {
    apiPrefix = "",
    modules = discoverModules(),
    clearRegistry = true,
    registry = routeRegistry,
  } = options;

  if (clearRegistry) {
    registry.clear();
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

  const prefixed = prefixApiModuleRoutes(apiPrefix, moduleRoutes, metadata);

  return applyModuleRouteMiddleware(
    registerOpenApiRouteMap(prefixed.routes, ["global", "api"], prefixed.metadata, registry),
    middleware,
  ) as AppRouteMap;
}

export type { BuildModuleRoutesOptions };
export { buildModuleRoutes, registerOpenApiRouteMap };
