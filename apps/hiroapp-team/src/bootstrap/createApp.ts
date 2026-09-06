import { join } from "node:path";
import "./preload.ts";
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
import { mergeSpaRoutes } from "@getstrata/bootstrap/createSpaRoutes";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { migrate } from "../db/migrate.ts";
import { buildRoutes } from "../routes.ts";
import { loadConfig } from "./config.ts";
import { getSql } from "./database.ts";
import { ensureAppDatabase } from "./ensureDatabase.ts";
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
  const isProduction = process.env.APP_ENV === "production";
  // Dev boots migrate for convenience. Production must not mutate schema on
  // start, so run `strata migrate` as an explicit deploy step instead.
  const { migrate: runMigrate = !isProduction } = options;

  if (isProduction) {
    assertProductionSecrets();
  }

  await ensureAppDatabase();
  const appConfig = loadConfig();
  getSql();
  configureModulesDirectory(join(import.meta.dir, "../modules"));
  await ensureModulesLoaded();
  const context = createAppContext();

  if (runMigrate) {
    await migrate();
  }

  const routes = mergeSpaRoutes(
    context.dependencies,
    {
      ...createHealthRoutes(context.dependencies),
      ...buildRoutes(context.dependencies),
      ...createMetricsRoutes(),
    },
    {
      distDirectory: join(import.meta.dir, "../../frontend/dist"),
    },
  );

  return { context, routes, config: appConfig };
}

export async function createApp(options: BootstrapOptions = {}) {
  return bootstrapApp({ migrate: false, ...options });
}

export function createAppServer(routes: AppRouteMap, port = 0) {
  return createWebServer({
    port,
    publicDir: "./public",
    routes,
  });
}

export { createAppContext };
