import { createCachedJson } from "./cachedJson";
import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { createHttpKernel } from "./httpKernel";
import { applyModuleRouteMiddleware } from "./moduleRouteMiddleware";
import { discoverModules } from "./modules";
import { registerOpenApiRouteMap } from "./routeMetadata";
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
  const cachedJson = createCachedJson(dependencies);
  const middleware = kernel.globalMiddleware("web");
  const moduleRoutes: Record<string, unknown> = { ...seedRoutes };

  for (const module of modules) {
    if (!module.webRoutes) {
      continue;
    }

    Object.assign(
      moduleRoutes,
      module.webRoutes({
        dependencies,
        cachedJson,
        kernel,
      }),
    );
  }

  return applyModuleRouteMiddleware(
    registerOpenApiRouteMap(moduleRoutes, ["global", "web"]),
    middleware,
  ) as AppRouteMap;
}

export type { BuildWebModuleRoutesOptions };
export { buildWebModuleRoutes };
