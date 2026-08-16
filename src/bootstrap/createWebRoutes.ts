import { join } from "node:path";
import { isViewsEnabled } from "../config/frontend";
import { applyMiddlewareToRoutes } from "../core/http/middleware";
import { htmlResponse } from "../core/view";
import type { AppDependencies, AppRouteMap } from "./contracts";
import { createHttpKernel } from "./httpKernel";
import { discoverModules } from "./modules";
import { routeRegistry } from "./routeRegistry";

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

function createWebRoutes(dependencies: AppDependencies): AppRouteMap {
  const kernel = createHttpKernel(dependencies);
  const middleware = [...kernel.globalMiddleware(), ...kernel.group("web")];
  const moduleRoutes: Record<string, unknown> = {
    "/": () => Response.redirect("/organizations", 302),
  };

  registerRoute("GET", "/", ["global", "web"]);

  for (const module of discoverModules()) {
    if (!module.webRoutes) {
      continue;
    }

    Object.assign(
      moduleRoutes,
      module.webRoutes({
        dependencies,
        cachedJson: async () => htmlResponse(""),
        kernel,
      }),
    );
  }

  const wrappedRoutes = applyMiddlewareToRoutes(
    registerRouteMap(moduleRoutes, ["global", "web"]),
    middleware,
  );

  wrappedRoutes["/assets/*"] = async (request: Request) => {
    registerRoute("GET", "/assets/*", ["global", "web"]);

    const pathname = new URL(request.url).pathname;
    const relativePath = pathname.replace(/^\//, "");
    const file = Bun.file(join(process.cwd(), "public", relativePath));

    if (!(await file.exists())) {
      return htmlResponse("Not Found", { status: 404 });
    }

    return new Response(file);
  };

  registerRoute("GET", "/assets/*", ["global", "web"]);

  return wrappedRoutes as AppRouteMap;
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
