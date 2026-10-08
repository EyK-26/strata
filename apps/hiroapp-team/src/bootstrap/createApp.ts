import { join } from "node:path";
import "./preload.ts";
import {
  createAppContext as createProviderAppContext,
  type InitializedAppContext,
} from "@getstrata/bootstrap/context";
import type { AppRouteMap } from "@getstrata/bootstrap/contracts";
import { mergeSpaRoutes } from "@getstrata/bootstrap/createSpaRoutes";
import {
  configureModulesDirectory,
  discoverModules,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import {
  assertProductionSecrets,
  assertRlsLiveDatabaseRole,
} from "@getstrata/bootstrap/secretsGuard";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { isRlsTenancy } from "@getstrata/core/tenant/tenancyConfig";
import { migrate } from "../db/migrate.ts";
import { buildRoutes } from "../routes.ts";
import { loadConfig } from "./config.ts";
import { closeDatabase, getSql, pingDatabase } from "./database.ts";
import { ensureAppDatabase } from "./ensureDatabase.ts";
import { starterProviders } from "./providers/index.ts";

export interface BootstrapOptions {
  migrate?: boolean;
}

export interface BootstrappedApp {
  context: InitializedAppContext;
  routes: AppRouteMap;
  config: ReturnType<typeof loadConfig>;
}

async function createAppContext(): Promise<InitializedAppContext> {
  await ensureModulesLoaded();
  const moduleProviders = discoverModules().flatMap((module) => module.providers ?? []);
  return createProviderAppContext([...starterProviders, ...moduleProviders]);
}

export async function bootstrapApp(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
  let context: InitializedAppContext | undefined;
  try {
    const isProduction = isProductionEnv();
    // Dev boots migrate for convenience. Production must not mutate schema on
    // start, so run `strata migrate` as an explicit deploy step instead.
    const { migrate: runMigrate = !isProduction } = options;

    if (isProduction) {
      assertProductionSecrets();
    }

    await ensureAppDatabase();
    const appConfig = loadConfig();
    getSql();
    if (!(await pingDatabase())) throw new Error("Database is not ready.");
    if (isRlsTenancy()) {
      await assertRlsLiveDatabaseRole();
    }
    configureModulesDirectory(join(import.meta.dir, "../modules"));
    await ensureModulesLoaded();
    context = await createAppContext();

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
  } catch (error) {
    const failures: unknown[] = [];
    for (const cleanup of [() => context?.dispose(), closeDatabase]) {
      try {
        await cleanup();
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length)
      throw new AggregateError([error, ...failures], "Application startup and cleanup failed.", {
        cause: error,
      });
    throw error;
  }
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
