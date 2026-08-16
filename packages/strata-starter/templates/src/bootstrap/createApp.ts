import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { runProviderPhase } from "@getstrata/bootstrap/context";
import { createRouteKernel } from "@getstrata/bootstrap/web/routing";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { applyMiddlewareToRoutes, createAuthMiddleware } from "@getstrata/core";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import {
  type AppContext,
  type AppDependencies,
  type AppRouteMap,
  assertAppDependenciesComplete,
  type ConfigStore,
  type MutableAppDependencies,
  type ProviderContext,
} from "@getstrata/core/contracts/di";
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
  const { migrate: runMigrate = true } = options;

  const appConfig = loadConfig();
  const context = createAppContext();

  if (runMigrate) {
    await migrate();
  }

  const routes = buildRoutes(context.dependencies);

  return { context, routes, config: appConfig };
}

export function createAppServer(routes: AppRouteMap, port = 0, dependencies?: AppDependencies) {
  const kernel = dependencies ? createRouteKernel(dependencies) : null;
  const wrappedRoutes =
    kernel && dependencies
      ? (applyMiddlewareToRoutes(routes, [
          createAuthMiddleware(dependencies.container.resolve(CORE_AUTH_TOKEN)),
          ...kernel.group("web"),
        ]) as AppRouteMap)
      : routes;

  return createWebServer({
    port,
    publicDir: "./public",
    routes: wrappedRoutes,
  });
}

export { createAppContext };
