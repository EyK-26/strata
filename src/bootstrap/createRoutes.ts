import { jsonResponse } from "@getstrata/core/http";
import { applyMiddlewareToRoutes } from "@getstrata/core/http/middleware";
import { htmlResponse } from "@getstrata/core/view";
import index from "../../index.html";
import { appConfig } from "../config/app";
import { isFeatureEnabled } from "../config/features";
import { isSpaEnabled, isViewsEnabled } from "../config/frontend";
import { buildModuleRoutes, registerOpenApiRouteMap } from "./buildModuleRoutes";
import type { AppDependencies, AppRouteMap } from "./contracts";
import { mergeSpaRoutes } from "./createSpaRoutes";
import { mergeWebRoutes } from "./createWebRoutes";
import { createHealthRoutes } from "./health";
import { createHttpKernel } from "./httpKernel";
import { createMetricsRoutes } from "./metricsRoutes";
import { routeRegistry } from "./routeRegistry";
import { createScimRoutes } from "./scimRoutes";

function registerRoute(method: string, path: string, middleware: string[]): void {
  routeRegistry.register({ method, path, middleware });
}

function createRoutes(dependencies: AppDependencies): AppRouteMap {
  const kernel = createHttpKernel(dependencies);
  const wrappedModuleRoutes = buildModuleRoutes(dependencies, {
    apiPrefix: appConfig.apiPrefix,
    clearRegistry: true,
  });

  const healthRoutes = createHealthRoutes(dependencies);
  const metricsRoutes = createMetricsRoutes();
  const scimRoutes = isFeatureEnabled("scim")
    ? applyMiddlewareToRoutes(
        registerOpenApiRouteMap(createScimRoutes(dependencies), ["global", "scim"]),
        kernel.globalMiddleware(),
      )
    : {};
  registerRoute("GET", "/health", []);
  registerRoute("GET", "/ready", []);
  registerRoute("GET", "/metrics", []);

  const baseRoutes: AppRouteMap = {
    ...healthRoutes,
    ...metricsRoutes,
    ...scimRoutes,
    ...(isViewsEnabled() || isSpaEnabled() ? {} : { "/": index }),
    ...wrappedModuleRoutes,
    [`${appConfig.apiPrefix}/*`]: async () => {
      registerRoute("GET", `${appConfig.apiPrefix}/*`, ["global", "api"]);
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    },
    "/*": async () => {
      registerRoute("GET", "/*", []);
      if (isViewsEnabled()) {
        return htmlResponse("Not Found", { status: 404 });
      }

      if (isSpaEnabled()) {
        return jsonResponse({ error: "Not Found" }, { status: 404 });
      }

      return jsonResponse({ error: "Not Found" }, { status: 404 });
    },
  };

  return mergeSpaRoutes(dependencies, mergeWebRoutes(dependencies, baseRoutes));
}

export { createRoutes };
