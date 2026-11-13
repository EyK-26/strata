import { type AppContextOptions, createAppContext } from "@getstrata/bootstrap/context";
import {
  type AppDependencies,
  type AppRouteMap,
  assertAppDependenciesComplete,
  type ServiceProvider,
} from "@getstrata/bootstrap/contracts";
import { webServerResource } from "@getstrata/bootstrap/web/server";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { createRoutes } from "../bootstrap/createRoutes";

interface CreateTestAppOptions {
  /** Explicit overrides let integration tests use their own migrated database. */
  application?: AppContextOptions;
}
interface TestApp {
  server: ReturnType<typeof Bun.serve>;
  application: Awaited<ReturnType<typeof createAppContext>>["application"];
  dependencies: AppDependencies;
  routes: AppRouteMap;
  baseUrl: string;
  stop: () => Promise<void>;
}
async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const configured: AppContextOptions = options.application ?? {
    connection: "test",
    definition: {
      providers: [],
      services: createDatabaseBindings({
        default: "test",
        connections: { test: { driver: "sqlite", filename: ":memory:" } },
      }),
    },
    http: {
      tenancy: "none",
      production: false,
      allowTenantDevHeaders: false,
      metadata: () => ({
        authenticate: async () => ({ status: "absent", user: null, credentialSource: null }),
        memberships: async () => [],
        userTenantId: async () => 1,
        tenant: async (id) => ({ id, slug: "test" }),
      }),
    },
  };
  let routes: AppRouteMap | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  const assemble: ServiceProvider = {
    name: "test.routes",
    boot: ({ dependencies }) => {
      assertAppDependenciesComplete(dependencies);
      routes = createRoutes(dependencies);
    },
  };
  const context = await createAppContext(undefined, {
    ...configured,
    providersFromScope: (scope) => [...(configured.providersFromScope?.(scope) ?? []), assemble],
    definition: {
      ...configured.definition,
      transports: [
        ...(configured.definition.transports ?? []),
        {
          name: "test.http",
          setup: async (scope) => {
            if (!routes) throw new Error("Test routes must be assembled before transport startup.");
            server = await scope.acquire(
              webServerResource({ port: 0, native: { hostname: "127.0.0.1" }, routes }),
            );
          },
        },
      ],
    },
  });
  if (!server || !routes) {
    await context.dispose();
    throw new Error("Test server did not start.");
  }
  return {
    server,
    application: context.application,
    dependencies: context.dependencies,
    routes,
    baseUrl: server.url.toString().replace(/\/$/, ""),
    stop: () => context.dispose(),
  };
}

export type { CreateTestAppOptions, TestApp };
export { createTestApp };
