import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import type { AppDependencies, AppModule, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";

export function buildRoutes(
  dependencies: AppDependencies,
  modules: readonly AppModule[],
): AppRouteMap {
  return isViewsEnabled() ? buildWebModuleRoutes(dependencies, { modules }) : {};
}
