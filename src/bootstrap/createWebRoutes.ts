import { join } from "node:path";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import { buildWebModuleRoutes } from "./buildWebModuleRoutes";
import type { AppDependencies, AppRouteMap } from "./contracts";
import { routeRegistry } from "./routeRegistry";

function registerRoute(method: string, path: string, middleware: string[]): void {
  routeRegistry.register({ method, path, middleware });
}

function createWebRoutes(dependencies: AppDependencies): AppRouteMap {
  const wrappedRoutes = buildWebModuleRoutes(dependencies, {
    clearRegistry: false,
    seedRoutes: {
      "/": () => Response.redirect("/organizations", 302),
    },
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

function mergeWebRoutes(dependencies: AppDependencies, routes: AppRouteMap): AppRouteMap {
  if (!isViewsEnabled()) {
    return routes;
  }

  return {
    ...createWebRoutes(dependencies),
    ...routes,
  };
}

export { createWebRoutes, mergeWebRoutes };
