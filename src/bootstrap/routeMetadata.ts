import type { CompiledRoutePlan } from "./routeCompiler";
import { attachRouteInventory } from "./routeCompiler";

function publishRoutePlan(
  plan: CompiledRoutePlan,
  routes: Record<string, unknown> = plan.routes,
): Record<string, unknown> {
  return attachRouteInventory(routes, plan.inventory);
}

export { publishRoutePlan };
