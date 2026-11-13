import type { AppDependencies, AppRouteMap } from "./contracts";
import { createRoutes } from "./createRoutes";
/** Compile once in the caller's application assembly; never cache another owner's routes. */
export function buildRoutes(dependencies: AppDependencies): AppRouteMap {
  return createRoutes(dependencies);
}
