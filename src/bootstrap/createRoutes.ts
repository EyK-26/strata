import { jsonResponse } from "@getstrata/core/http/response";
import { isSpaEnabled, isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import index from "../../index.html";
import { appConfig } from "../config/app";
import { buildModuleRoutes } from "./buildModuleRoutes";
import type { AppDependencies, AppRouteMap } from "./contracts";
import { mergeSpaRoutes } from "./createSpaRoutes";
import { mergeWebRoutes } from "./createWebRoutes";
import { isHiroappDogfood } from "./dogfoodApp";
import { createHealthRoutes } from "./health";
import { createMetricsRoutes } from "./metricsRoutes";
import { routeRegistry } from "./routeRegistry";

function registerRoute(method: string, path: string, middleware: string[]): void {
  routeRegistry.register({ method, path, middleware });
}

function createRoutes(dependencies: AppDependencies): AppRouteMap {
  const apiPrefix = isHiroappDogfood() ? "" : appConfig.apiPrefix;
  const wrappedModuleRoutes = buildModuleRoutes(dependencies, {
    apiPrefix,
    clearRegistry: true,
    modules: [],
  });

  const healthRoutes = createHealthRoutes(dependencies);
  const metricsRoutes = createMetricsRoutes();
  registerRoute("GET", "/health", []);
  registerRoute("GET", "/ready", []);
  registerRoute("GET", "/metrics", []);

  const notFoundApiPath = `${apiPrefix || "/api"}/*`;
  const baseRoutes: AppRouteMap = {
    ...healthRoutes,
    ...metricsRoutes,
    ...(isViewsEnabled() || isSpaEnabled() ? {} : { "/": index }),
    ...wrappedModuleRoutes,
    [notFoundApiPath]: async () => {
      registerRoute("GET", notFoundApiPath, ["global", "api"]);
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    },
    "/*": async () => {
      registerRoute("GET", "/*", []);
      if (isViewsEnabled()) {
        return notFoundHtmlResponse();
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
