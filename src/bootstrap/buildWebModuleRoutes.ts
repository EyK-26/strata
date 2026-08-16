import { applyMiddlewareToRoutes } from "@getstrata/core/http/middleware";
import { registerOpenApiRouteMap } from "./buildModuleRoutes";
import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { createHttpKernel } from "./httpKernel";
import { discoverModules } from "./modules";
import { routeRegistry } from "./routeRegistry";

interface BuildWebModuleRoutesOptions {
  modules?: AppModule[];
  clearRegistry?: boolean;
  seedRoutes?: Record<string, unknown>;
}

function buildWebModuleRoutes(
  dependencies: AppDependencies,
  options: BuildWebModuleRoutesOptions = {},
): AppRouteMap {
  const { modules = discoverModules(), clearRegistry = true, seedRoutes = {} } = options;

  if (clearRegistry) {
    routeRegistry.clear();
  }

  const kernel = createHttpKernel(dependencies);
  const middleware = [...kernel.globalMiddleware(), ...kernel.group("web")];
  const moduleRoutes: Record<string, unknown> = { ...seedRoutes };

  for (const module of modules) {
    if (!module.webRoutes) {
      continue;
    }

    Object.assign(
      moduleRoutes,
      module.webRoutes({
        dependencies,
        cachedJson: async () => new Response(""),
        kernel,
      }),
    );
  }

  return applyMiddlewareToRoutes(
    registerOpenApiRouteMap(moduleRoutes, ["global", "web"]),
    middleware,
  ) as AppRouteMap;
}

export type { BuildWebModuleRoutesOptions };
export { buildWebModuleRoutes };
