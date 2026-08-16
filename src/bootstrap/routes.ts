import { appContext } from "./context";
import type { AppRouteMap } from "./contracts";
import { createRoutes } from "./createRoutes";

let cachedRoutes: AppRouteMap | undefined;

function buildRoutes(): AppRouteMap {
  cachedRoutes ??= createRoutes(appContext.dependencies);
  return cachedRoutes;
}

export { buildRoutes };
