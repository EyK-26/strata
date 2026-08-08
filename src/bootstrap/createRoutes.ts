import type { AppDependencies, AppRouteMap } from "./contracts";
import { jsonResponse } from "../core/http";
import { applyMiddlewareToRoutes } from "../core/http/middleware";
import { appModules } from "./modules";
import { createHttpKernel } from "./httpKernel";
import index from "../../index.html";

function createRoutes(dependencies: AppDependencies): AppRouteMap {
  const kernel = createHttpKernel(dependencies);

  const cachedJson = async <T>(
    cacheKey: string,
    loader: () => Promise<T>,
    tags: string[] = [],
  ): Promise<Response> => {
    const data =
      tags.length > 0
        ? await dependencies.cache.tags(...tags).remember(cacheKey, loader)
        : await dependencies.cache.remember(cacheKey, loader);

    return jsonResponse(data);
  };

  const moduleRoutes: Record<string, unknown> = {};

  for (const module of appModules) {
    if (!module.routes) {
      continue;
    }

    Object.assign(
      moduleRoutes,
      module.routes({ dependencies, cachedJson, kernel }),
    );
  }

  return applyMiddlewareToRoutes(
    {
      "/": index,
      ...moduleRoutes,
      "/*": async () => {
        return jsonResponse({ error: "Not Found" }, { status: 404 });
      },
    },
    [...kernel.globalMiddleware(), ...kernel.group("api")],
  );
}

export { createRoutes };
