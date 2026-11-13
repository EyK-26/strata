import { resolve } from "node:path";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { assertUrlPathUnderRoot } from "@getstrata/core/security/safePath";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import { CORE_WEB_ERROR_VIEW_TOKEN } from "@getstrata/core/view/tokens";
import { buildWebModuleRoutes } from "./buildWebModuleRoutes";
import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { compileRoutePlan } from "./routeCompiler";
import { publishRoutePlan } from "./routeMetadata";

interface CreateWebRoutesOptions {
  modules?: readonly AppModule[];
  publicDir?: string;
}

function createWebRoutes(
  dependencies: AppDependencies,
  options: CreateWebRoutesOptions = {},
): AppRouteMap {
  const wrappedRoutes = buildWebModuleRoutes(dependencies, {
    modules: options.modules ?? [],
  });

  const publicDir = resolve(options.publicDir ?? "public");
  const renderError = dependencies.container.has(CORE_WEB_ERROR_VIEW_TOKEN)
    ? dependencies.container.resolve(CORE_WEB_ERROR_VIEW_TOKEN)
    : undefined;
  const assetHandler = async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    try {
      const filePath = assertUrlPathUnderRoot(publicDir, pathname);
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        return notFoundHtmlResponse(undefined, renderError);
      }

      return new Response(file);
    } catch {
      return notFoundHtmlResponse(undefined, renderError);
    }
  };

  const plan = compileRoutePlan([
    { name: "web modules", routes: wrappedRoutes },
    { name: "public assets", routes: { "/assets/*": assetHandler }, middleware: [] },
  ]);
  return publishRoutePlan(plan, plan.routes) as AppRouteMap;
}

function mergeWebRoutes(
  dependencies: AppDependencies,
  routes: AppRouteMap,
  options: CreateWebRoutesOptions = {},
): AppRouteMap {
  if (!isViewsEnabled()) {
    return routes;
  }

  const webRoutes = createWebRoutes(dependencies, options);
  const plan = compileRoutePlan([
    { name: "web", routes: webRoutes },
    { name: "application", routes },
  ]);
  return publishRoutePlan(plan, plan.routes) as AppRouteMap;
}

export type { CreateWebRoutesOptions };
export { createWebRoutes, mergeWebRoutes };
