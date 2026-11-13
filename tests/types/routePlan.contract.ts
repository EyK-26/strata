import { compileRouteMap, getRouteInventory } from "@getstrata/bootstrap/routePlan";
// @ts-expect-error Process-global route registries have been retired.
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";

const routes = compileRouteMap({ "/example": { GET: () => new Response() } });
const inventory = getRouteInventory(routes);
// @ts-expect-error Inventories are immutable snapshots.
inventory.push({ method: "POST", path: "/injected", middleware: [] });
const route = inventory[0];
if (route) {
  // @ts-expect-error Nested middleware is immutable too.
  route.middleware.push("web");
  // @ts-expect-error Route identity cannot be changed after compilation.
  route.path = "/changed";
}
void routeRegistry;
