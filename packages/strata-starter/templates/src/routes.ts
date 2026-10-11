import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";

export function buildRoutes(dependencies: AppDependencies): AppRouteMap {
  return isViewsEnabled() ? buildWebModuleRoutes(dependencies) : {};
}
