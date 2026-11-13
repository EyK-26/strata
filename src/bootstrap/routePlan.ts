import type { OpenApiRouteMap, RegisteredRoute } from "@getstrata/core/openapi/registeredRoute";
import { compileRoutePlan, getRouteInventory } from "./routeCompiler";

/** Validate and snapshot an owned route map, preserving any existing attached contracts. */
function compileRouteMap(
  routes: Record<string, unknown>,
  options: { middleware?: string[]; metadata?: OpenApiRouteMap } = {},
): Record<string, unknown> {
  if (options.middleware !== undefined || options.metadata !== undefined) {
    try {
      getRouteInventory(routes);
    } catch {
      return compileRoutePlan([{ name: "routes", routes, ...options }]).routes;
    }
    throw new Error("Cannot replace contracts or middleware on an already compiled route map");
  }
  return compileRoutePlan([{ name: "routes", routes }]).routes;
}

/** Compose already compiled or raw maps without losing per-operation metadata. */
function composeRouteMaps(...maps: Record<string, unknown>[]): Record<string, unknown> {
  return compileRoutePlan(maps.map((routes, index) => ({ name: `routes ${index + 1}`, routes })))
    .routes;
}

export type { RegisteredRoute };
export { compileRouteMap, composeRouteMaps, getRouteInventory };
