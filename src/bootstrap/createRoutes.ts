import index from "../../index.html";
import { appConfig } from "../config/app";
import { isFeatureEnabled } from "../config/features";
import { jsonResponse } from "../core/http";
import { applyMiddlewareToRoutes } from "../core/http/middleware";
import type { AppDependencies, AppRouteMap } from "./contracts";
import { createHealthRoutes } from "./health";
import { createHttpKernel } from "./httpKernel";
import { createMetricsRoutes } from "./metricsRoutes";
import { appModules } from "./modules";
import { prefixRouteMap } from "./prefixRouteMap";
import { routeRegistry } from "./routeRegistry";
import { createScimRoutes } from "./scimRoutes";

function registerRoute(method: string, path: string, middleware: string[]): void {
  routeRegistry.register({ method, path, middleware });
}

function registerRouteMap(
  routes: Record<string, unknown>,
  middleware: string[],
): Record<string, unknown> {
  const registered: Record<string, unknown> = {};

  for (const [path, handler] of Object.entries(routes)) {
    if (handler && typeof handler === "object" && !Array.isArray(handler)) {
      const methodMap = handler as Record<string, unknown>;
      registered[path] = methodMap;

      for (const method of Object.keys(methodMap)) {
        registerRoute(method.toUpperCase(), path, middleware);
      }
      continue;
    }

    registered[path] = handler;
    registerRoute("GET", path, middleware);
  }

  return registered;
}

function createRoutes(dependencies: AppDependencies): AppRouteMap {
  const kernel = createHttpKernel(dependencies);
  const middleware = [...kernel.globalMiddleware(), ...kernel.group("api")];

  const cachedJson = async <T>(
    cacheKey: string,
    loader: () => Promise<T>,
    tags: string[] = [],
  ): Promise<Response> => {
    const data =
      tags.length > 0
        ? await dependencies.cache.tags(...tags).remember(cacheKey, loader)
        : await dependencies.cache.remember(cacheKey, loader);

    return jsonResponse(data);
  };

  const moduleRoutes: Record<string, unknown> = {};

  for (const module of appModules) {
    if (!module.routes) {
      continue;
    }

    Object.assign(moduleRoutes, module.routes({ dependencies, cachedJson, kernel }));
  }

  const prefixedModuleRoutes = prefixRouteMap(appConfig.apiPrefix, moduleRoutes);
  const wrappedModuleRoutes = applyMiddlewareToRoutes(
    registerRouteMap(prefixedModuleRoutes, ["global", "api"]),
    middleware,
  );

  const healthRoutes = createHealthRoutes(dependencies);
  const metricsRoutes = createMetricsRoutes();
  const scimRoutes = isFeatureEnabled("scim")
    ? applyMiddlewareToRoutes(
        registerRouteMap(createScimRoutes(dependencies), ["global", "scim"]),
        kernel.globalMiddleware(),
      )
    : {};
  registerRoute("GET", "/health", []);
  registerRoute("GET", "/ready", []);
  registerRoute("GET", "/metrics", []);

  return {
    ...healthRoutes,
    ...metricsRoutes,
    ...scimRoutes,
    "/": index,
    ...wrappedModuleRoutes,
    [`${appConfig.apiPrefix}/*`]: async () => {
      registerRoute("GET", `${appConfig.apiPrefix}/*`, ["global", "api"]);
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    },
    "/*": async () => {
      registerRoute("GET", "/*", []);
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    },
  };
}

export { createRoutes };
