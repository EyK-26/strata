import { runProviderPhase } from "@getstrata/bootstrap/context";
import {
  type AppContext,
  type AppDependencies,
  type AppRouteMap,
  assertAppDependenciesComplete,
  type ConfigStore,
  type MutableAppDependencies,
  type ProviderContext,
  ServiceContainer,
} from "@getstrata/bootstrap/contracts";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { migrate } from "../db/migrate.ts";
import { buildRoutes } from "../routes.ts";
import { loadConfig } from "./config.ts";
import { starterProviders } from "./providers/index.ts";

export interface BootstrapOptions {
  migrate?: boolean;
}

export interface BootstrappedApp {
  context: AppContext;
  routes: AppRouteMap;
  config: ReturnType<typeof loadConfig>;
}

class AppConfigStore {
  private readonly values = new Map<string, unknown>();

  set<T>(key: string, value: T): T {
    this.values.set(key, value);
    return value;
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  require<T>(key: string): T {
    const value = this.get<T>(key);
    if (value === undefined) {
      throw new Error(`Missing required config value "${key}".`);
    }
    return value;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

function createAppContext(): AppContext {
  const container = new ServiceContainer();
  const config = new AppConfigStore() as unknown as ConfigStore;
  const dependencies: MutableAppDependencies = { container };
  const context: ProviderContext = { container, config, dependencies };

  runProviderPhase(starterProviders, "register", context);
  runProviderPhase(starterProviders, "boot", context);

  assertAppDependenciesComplete(dependencies);

  const appContext = { container, config, dependencies: dependencies as AppDependencies };
  setActiveApplicationContext(appContext as never);
  return appContext;
}

export async function bootstrapApp(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
  const isProduction = isProductionEnv();
  const { migrate: runMigrate = !isProduction } = options;

  const appConfig = loadConfig();
  const context = createAppContext();

  if (runMigrate) {
    await migrate();
  }

  const routes = buildRoutes(context.dependencies);

  return { context, routes, config: appConfig };
}

export function createAppServer(routes: AppRouteMap, port = 0) {
  return createWebServer({
    port,
    publicDir: "./public",
    routes,
  });
}

export { createAppContext };
