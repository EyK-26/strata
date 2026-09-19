import { createAppContext } from "@getstrata/bootstrap/context";
import { createRoutes } from "../../bootstrap/createRoutes";
import { importHiroappModule, isHiroappDogfood } from "../../bootstrap/dogfoodApp";

function withoutSpaCatchAll(routes: Record<string, unknown>): Record<string, unknown> {
  const next = { ...routes };
  delete next["/*"];
  return next;
}

async function bootstrapMonorepoOpenApiRoutes(): Promise<{ routes: Record<string, unknown> }> {
  if (isHiroappDogfood()) {
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
      return { routes: withoutSpaCatchAll(routes) };
    } finally {
      if (previousFrontendMode === undefined) {
        delete process.env.FRONTEND_MODE;
      } else {
        process.env.FRONTEND_MODE = previousFrontendMode;
      }
    }
  }

  const { dependencies } = createAppContext();
  const routes = createRoutes(dependencies);
  return { routes: withoutSpaCatchAll(routes) };
}

export { bootstrapMonorepoOpenApiRoutes };
