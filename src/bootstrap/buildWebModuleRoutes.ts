import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { createHttpKernel } from "./httpKernel";
import { createLegacyCachedJson } from "./legacyCache";
import { enterModuleRoutes } from "./moduleRouteMiddleware";
import { discoverModules } from "./modules";
import type { BusinessRouteHandler } from "./persistenceContracts";
import type { RouteSource } from "./routeCompiler";
import { compileRoutePlan } from "./routeCompiler";
import { publishRoutePlan } from "./routeMetadata";

interface BuildWebModuleRoutesOptions {
  modules?: AppModule[];
  clearRegistry?: boolean;
  seedRoutes?: Record<string, unknown>;
  /** Defer registry publication while composing a larger route plan. */
  register?: boolean;
}

function buildWebModuleRoutes(
  dependencies: AppDependencies,
  options: BuildWebModuleRoutesOptions = {},
): AppRouteMap {
  const { modules = discoverModules(), clearRegistry = true, seedRoutes = {} } = options;

  const kernel = createHttpKernel(dependencies);
  const cachedJson = createLegacyCachedJson(dependencies);

  const sources: RouteSource[] = [
    { name: "seed routes", routes: seedRoutes, middleware: ["global", "web"] },
  ];

  for (const module of modules) {
    if (!module.webRoutes) {
      continue;
    }

    sources.push({
      name: module.name,
      routes: module.webRoutes({ dependencies, cachedJson, kernel }),
      middleware: ["global", "web"],
    });
  }

  const plan = compileRoutePlan(sources);
  const routes = enterModuleRoutes(plan.routes, (callback) =>
    kernel.composed(callback as BusinessRouteHandler, "web"),
  );
  return publishRoutePlan(plan, routes, {
    clearRegistry,
    register: options.register,
  }) as AppRouteMap;
}

export type { BuildWebModuleRoutesOptions };
export { buildWebModuleRoutes };
