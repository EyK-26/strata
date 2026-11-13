import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { identityModes, scimMiddleware } from "#strata-http-route";
import type { AppDependencies, AppModule, AppRouteMap } from "./contracts";
import { createHttpKernel } from "./httpKernel";
import { createLegacyCachedJson } from "./legacyCache";
import { enterModuleRoutes } from "./moduleRouteMiddleware";
import { discoverModules } from "./modules";
import type { BusinessRouteHandler } from "./persistenceContracts";
import type { RouteSource } from "./routeCompiler";
import { compileRoutePlan } from "./routeCompiler";
import { publishRoutePlan } from "./routeMetadata";

interface BuildModuleRoutesOptions {
  apiPrefix?: string;
  modules?: AppModule[];
}

function buildModuleRoutes(
  dependencies: AppDependencies,
  options: BuildModuleRoutesOptions = {},
): AppRouteMap {
  const { apiPrefix = "", modules = discoverModules() } = options;

  const kernel = createHttpKernel(dependencies);
  const middleware = kernel.group("api");
  const cachedJson = createLegacyCachedJson(dependencies);
  const sources: RouteSource[] = [];

  for (const module of modules) {
    if (!module.routes) {
      continue;
    }

    sources.push({
      name: module.name,
      routes: module.routes({ dependencies, cachedJson, kernel }),
      metadata: module.openApi,
      middleware: ["global", "api"],
    });
  }

  const plan = compileRoutePlan(sources, apiPrefix);
  const routes = enterModuleRoutes(plan.routes, (callback) =>
    kernel.composed(
      withMiddleware(...middleware)(callback as BusinessRouteHandler),
      "json",
      identityModes(callback),
      scimMiddleware(callback),
    ),
  );
  return publishRoutePlan(plan, routes) as AppRouteMap;
}

export type { BuildModuleRoutesOptions };
export { buildModuleRoutes };
