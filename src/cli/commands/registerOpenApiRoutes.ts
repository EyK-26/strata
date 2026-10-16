import { registerAppOpenApiRoutes } from "@getstrata/cli/openapi";
import { importHiroappModule } from "../../bootstrap/dogfoodApp";

/** Temporary in-repo CLI adapter; the public CLI owns API-only route filtering. */
async function registerOpenApiRoutes(): Promise<void> {
  process.env.APP_KEY_PREFIX ??= "hiroapp";
  process.env.APP_NAME ??= "HiroApp";
  process.env.API_PREFIX ??= "/api";
  const previousFrontendMode = process.env.FRONTEND_MODE;
  process.env.FRONTEND_MODE = "api";
  try {
    await registerAppOpenApiRoutes(async () => {
      const { bootstrapApp } = await importHiroappModule<{
        bootstrapApp: (options: {
          migrate: boolean;
        }) => Promise<{ routes: Record<string, unknown>; context: { dispose(): Promise<void> } }>;
      }>("src/bootstrap/createApp.ts");
      const { closeDatabase } = await importHiroappModule<{ closeDatabase(): Promise<void> }>(
        "src/bootstrap/database.ts",
      );
      const app = await bootstrapApp({ migrate: false });
      try {
        return { routes: app.routes };
      } finally {
        try {
          await app.context.dispose();
        } finally {
          await closeDatabase();
        }
      }
    });
  } finally {
    if (previousFrontendMode === undefined) delete process.env.FRONTEND_MODE;
    else process.env.FRONTEND_MODE = previousFrontendMode;
  }
}

export { registerOpenApiRoutes };
