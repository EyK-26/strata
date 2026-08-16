import { createAppContext } from "@getstrata/bootstrap/context";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { createRoutes } from "../../bootstrap/createRoutes";

function routeListCommand(): void {
  const { dependencies } = createAppContext();
  createRoutes(dependencies);

  const routes = routeRegistry.list();

  if (routes.length === 0) {
    console.log("No routes registered.");
    return;
  }

  for (const route of routes) {
    const middleware = route.middleware.length > 0 ? ` [${route.middleware.join(", ")}]` : "";
    console.log(`${route.method.padEnd(7)} ${route.path}${middleware}`);
  }
}

export { routeListCommand };
