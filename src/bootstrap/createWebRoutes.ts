import { join } from "node:path";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { assertUrlPathUnderRoot } from "@getstrata/core/security/safePath";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import { buildWebModuleRoutes } from "./buildWebModuleRoutes";
import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { compileRoutePlan } from "./routeCompiler";
import { publishRoutePlan } from "./routeMetadata";

interface CreateWebRoutesOptions {
  modules?: AppModule[];
  register?: boolean;
}

function createWebRoutes(
  dependencies: AppDependencies,
  options: CreateWebRoutesOptions = {},
): AppRouteMap {
  const wrappedRoutes = buildWebModuleRoutes(dependencies, {
    clearRegistry: false,
    modules: options.modules,
    register: false,
  });

  const assetHandler = async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    try {
      const filePath = assertUrlPathUnderRoot(join(process.cwd(), "public"), pathname);
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        return notFoundHtmlResponse();
      }

      return new Response(file);
    } catch {
      return notFoundHtmlResponse();
    }
  };

  const plan = compileRoutePlan([
    { name: "web modules", routes: wrappedRoutes },
    { name: "public assets", routes: { "/assets/*": assetHandler }, middleware: [] },
  ]);
  return publishRoutePlan(plan, plan.routes, { register: options.register }) as AppRouteMap;
}

function mergeWebRoutes(
  dependencies: AppDependencies,
  routes: AppRouteMap,
  options: CreateWebRoutesOptions = {},
): AppRouteMap {
  if (!isViewsEnabled()) {
    return routes;
  }

  const webRoutes = createWebRoutes(dependencies, { ...options, register: false });
  const plan = compileRoutePlan([
    { name: "web", routes: webRoutes },
    { name: "application", routes },
  ]);
  return publishRoutePlan(plan, plan.routes, {
    clearRegistry: true,
    register: options.register,
  }) as AppRouteMap;
}

export type { CreateWebRoutesOptions };
export { createWebRoutes, mergeWebRoutes };
