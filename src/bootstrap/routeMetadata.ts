import type { OpenApiRouteMap } from "@getstrata/core/openapi/registeredRoute";
import type { CompiledRoutePlan } from "./routeCompiler";
import { attachRouteInventory, compileRoutePlan } from "./routeCompiler";
import { routeRegistry } from "./routeRegistry";

function publishRoutePlan(
  plan: CompiledRoutePlan,
  routes: Record<string, unknown> = plan.routes,
  options: { clearRegistry?: boolean; register?: boolean } = {},
): Record<string, unknown> {
  const result = attachRouteInventory(routes, plan.inventory);
  if (options.register !== false) {
    if (options.clearRegistry) routeRegistry.clear();
    for (const route of plan.inventory) routeRegistry.register(route);
  }
  return result;
}

function registerOpenApiRouteMap(
  routes: Record<string, unknown>,
  middleware: string[],
  metadata: OpenApiRouteMap = {},
): Record<string, unknown> {
  return publishRoutePlan(compileRoutePlan([{ name: "routes", routes, middleware, metadata }]));
}

export { publishRoutePlan, registerOpenApiRouteMap };
