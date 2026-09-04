import { registerOpenApiRouteMap } from "@getstrata/bootstrap/buildModuleRoutes";
import { createAppContext } from "@getstrata/bootstrap/context";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { createRoutes } from "../../bootstrap/createRoutes";
import { importHiroappModule, isHiroappDogfood } from "../../bootstrap/dogfoodApp";

function withoutSpaCatchAll(routes: Record<string, unknown>): Record<string, unknown> {
  const next = { ...routes };
  delete next["/*"];
  return next;
}

async function registerOpenApiRoutes(): Promise<void> {
  if (!isHiroappDogfood()) {
    const { dependencies } = createAppContext();
    createRoutes(dependencies);
    return;
  }

  process.env.APP_KEY_PREFIX ??= "hiroapp";
  process.env.APP_NAME ??= "HiroApp";
  process.env.API_PREFIX ??= "/api";
  const previousFrontendMode = process.env.FRONTEND_MODE;
  process.env.FRONTEND_MODE = "api";

  try {
    const { createApp } = await importHiroappModule<{
      createApp: () => Promise<{ routes: Record<string, unknown> }>;
    }>("src/bootstrap/createApp.ts");
    const { routes } = await createApp();
    routeRegistry.clear();
    registerOpenApiRouteMap(withoutSpaCatchAll(routes), ["global", "api"]);
  } finally {
    if (previousFrontendMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      process.env.FRONTEND_MODE = previousFrontendMode;
    }
  }
}

export { registerOpenApiRoutes };
