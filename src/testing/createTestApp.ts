import type { AppRouteMap } from "@getstrata/bootstrap/contracts";
import { createAppDependencies } from "@getstrata/bootstrap/dependencies";
import { createRoutes } from "../bootstrap/createRoutes";
import { freshDatabase } from "../db/migrations/runner";

interface CreateTestAppOptions {
  fresh?: boolean;
}

interface TestApp {
  server: ReturnType<typeof Bun.serve>;
  dependencies: ReturnType<typeof createAppDependencies>;
  routes: AppRouteMap;
  baseUrl: string;
  stop: () => void;
}

async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  if (options.fresh) {
    await freshDatabase({ seed: true });
  }

  const dependencies = createAppDependencies();
  const routes = createRoutes(dependencies);
  const server = Bun.serve({
    port: 0,
    routes,
  });
  const baseUrl = server.url.toString().replace(/\/$/, "");

  return {
    server,
    dependencies,
    routes,
    baseUrl,
    stop: () => {
      server.stop(true);
    },
  };
}

export type { CreateTestAppOptions, TestApp };
export { createTestApp };
