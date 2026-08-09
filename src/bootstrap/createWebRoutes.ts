import { join } from "node:path";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import { buildWebModuleRoutes } from "./buildWebModuleRoutes";
import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { routeRegistry } from "./routeRegistry";

interface CreateWebRoutesOptions {
  modules?: AppModule[];
}

function registerRoute(method: string, path: string, middleware: string[]): void {
  routeRegistry.register({ method, path, middleware });
}

function createWebRoutes(
  dependencies: AppDependencies,
  options: CreateWebRoutesOptions = {},
): AppRouteMap {
  const wrappedRoutes = buildWebModuleRoutes(dependencies, {
    clearRegistry: false,
    modules: options.modules,
  });

  registerRoute("GET", "/", ["global", "web"]);

  wrappedRoutes["/assets/*"] = async (request: Request) => {
    registerRoute("GET", "/assets/*", ["global", "web"]);

    const pathname = new URL(request.url).pathname;
    const relativePath = pathname.replace(/^\//, "");
    const file = Bun.file(join(process.cwd(), "public", relativePath));

    if (!(await file.exists())) {
      return notFoundHtmlResponse();
    }

    return new Response(file);
  };

  registerRoute("GET", "/assets/*", ["global", "web"]);

  return wrappedRoutes;
}

function mergeWebRoutes(
  dependencies: AppDependencies,
  routes: AppRouteMap,
  options: CreateWebRoutesOptions = {},
): AppRouteMap {
  if (!isViewsEnabled()) {
    return routes;
  }

  return {
    ...createWebRoutes(dependencies, options),
    ...routes,
  };
}

export type { CreateWebRoutesOptions };
export { createWebRoutes, mergeWebRoutes };
