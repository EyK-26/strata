import { jsonResponse } from "@getstrata/core/http/response";
import { isSpaEnabled, isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import { CORE_WEB_ERROR_VIEW_TOKEN } from "@getstrata/core/view/tokens";
import index from "../../index.html";
import { buildModuleRoutes } from "./buildModuleRoutes";
import type { AppDependencies, AppRouteMap } from "./contracts";
import { mergeSpaRoutes } from "./createSpaRoutes";
import { mergeWebRoutes } from "./createWebRoutes";
import { createHealthRoutes } from "./health";
import { createMetricsRoutes } from "./metricsRoutes";
import { compileRoutePlan } from "./routeCompiler";
import { publishRoutePlan } from "./routeMetadata";

function createRoutes(dependencies: AppDependencies): AppRouteMap {
  // Preserve the framework fixture route map; product prefixes belong to generated apps.
  const apiPrefix = "";
  const viewsEnabled = isViewsEnabled();
  const spaEnabled = isSpaEnabled();
  const renderError = dependencies.container.has(CORE_WEB_ERROR_VIEW_TOKEN)
    ? dependencies.container.resolve(CORE_WEB_ERROR_VIEW_TOKEN)
    : undefined;
  const wrappedModuleRoutes = buildModuleRoutes(dependencies, {
    apiPrefix,
    modules: [],
  });

  const healthRoutes = createHealthRoutes(dependencies);
  const metricsRoutes = createMetricsRoutes();

  const notFoundApiPath = `${apiPrefix || "/api"}/*`;
  const fallbackRoutes: AppRouteMap = {
    [notFoundApiPath]: async () => {
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    },
    "/*": async () => {
      if (viewsEnabled) {
        return notFoundHtmlResponse(undefined, renderError);
      }

      if (spaEnabled) {
        return jsonResponse({ error: "Not Found" }, { status: 404 });
      }

      return jsonResponse({ error: "Not Found" }, { status: 404 });
    },
  };

  const basePlan = compileRoutePlan([
    { name: "health", routes: healthRoutes },
    { name: "metrics", routes: metricsRoutes },
    { name: "index", routes: viewsEnabled || spaEnabled ? {} : { "/": index } },
    { name: "API modules", routes: wrappedModuleRoutes },
    { name: "fallbacks", routes: fallbackRoutes },
  ]);
  const merged = mergeSpaRoutes(
    dependencies,
    mergeWebRoutes(dependencies, basePlan.routes as AppRouteMap),
  );
  const plan = compileRoutePlan([{ name: "application", routes: merged }]);
  return publishRoutePlan(plan, plan.routes) as AppRouteMap;
}

export { createRoutes };
