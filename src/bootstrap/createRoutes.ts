import type { AppDependencies, AppRouteMap } from "./contracts";
import { jsonResponse } from "../core/http";
import { appModules } from "./modules";
import index from "../../index.html";

function createRoutes(dependencies: AppDependencies): AppRouteMap {
  const cachedJson = async <T>(
    cacheKey: string,
    loader: () => Promise<T>,
  ): Promise<Response> => {
    return jsonResponse(await dependencies.cache.getOrSet(cacheKey, loader));
  };

  const moduleRoutes: Record<string, any> = {};

  for (const module of appModules) {
    if (!module.routes) {
      continue;
    }

    Object.assign(moduleRoutes, module.routes({ dependencies, cachedJson }));
  }

  return {
    "/": index,
    ...moduleRoutes,
    "/*": async () => {
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    },
  };
}

export { createRoutes };
