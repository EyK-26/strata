import { defaultDatabaseUrl, defaultMigrationDatabaseUrl } from "./databaseDefaults.ts";
import { needsEnsure } from "./renderDatabase.ts";
import { htmlAuthKit, type StarterLayers } from "./types.ts";

function renderPreloadTs(layers: StarterLayers, projectName: string): string {
  const fallback = defaultDatabaseUrl(layers, projectName);
  const migrationFallback = defaultMigrationDatabaseUrl(layers, projectName);
  const migrationLine = migrationFallback
    ? `process.env.MIGRATION_DATABASE_URL ??= ${JSON.stringify(migrationFallback)};\n`
    : "";

  const databaseDefaults = needsEnsure(layers)
    ? `if (!isProductionEnv()) {\n  process.env.DATABASE_URL ??= ${JSON.stringify(fallback)};\n  ${migrationLine.trim()}\n}\n`
    : `process.env.DATABASE_URL ??= ${JSON.stringify(fallback)};\n`;
  return `import { join } from "node:path";
import { configureModulesDirectory } from "@getstrata/bootstrap/discoverModules";
${needsEnsure(layers) ? 'import { isProductionEnv } from "@getstrata/core/runtime/appEnv";\n' : ""}import "../models/register.ts";

${databaseDefaults}process.env.FRONTEND_MODE ??= ${JSON.stringify(layers.frontend)};
process.env.SPA_PREFIX ??= ${JSON.stringify(layers.spaPrefix)};
process.env.CACHE_DRIVER ??= ${JSON.stringify(layers.cache)};
process.env.QUEUE_DRIVER ??= ${JSON.stringify(layers.queue)};
${layers.queue === "redis" ? 'process.env.QUEUE_REDIS_TRANSPORT ??= "streams";\n' : ""}process.env.MAIL_DRIVER ??= ${JSON.stringify(layers.mail)};
process.env.TENANCY_DRIVER ??= ${JSON.stringify(layers.tenancy)};
configureModulesDirectory(join(import.meta.dir, "../modules"));
`;
}

function renderConfigTs(): string {
  return `export interface AppConfig {
  port: number;
  /** Optional listen address; independent of the trusted public APP_URL. */
  hostname?: string;
  appUrl: string;
  databaseUrl: string;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    hostname: process.env.HOST?.trim() || undefined,
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    databaseUrl,
  };
}

/** Cookie sessions and signed cookies are keyed by this; there is no default. */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required. Copy .env.example to .env and set it (32+ characters).",
    );
  }
  return secret;
}
`;
}

function renderConfigProvider(layers: StarterLayers): string {
  return `import {
  APP_PORT_CONFIG_KEY,
  CORE_CONFIG_TOKEN,
  CORE_PUBLIC_TENANCY_TOKEN,
  DATABASE_URL_CONFIG_KEY,
  REDIS_URL_CONFIG_KEY,
} from "@getstrata/bootstrap/config";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { normalizeTenantHostname } from "@getstrata/core/tenant/tenantMiddleware";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { loadConfig } from "../config.ts";

const configProvider: ServiceProvider = {
  name: "starter.config",
  register({ container, config }) {
    const appConfig = loadConfig();

    container.set(CORE_CONFIG_TOKEN, config);
    // One approved origin for the starter tenant. Multi-tenant apps replace this lookup.
    if (isProductionEnv()) {
      const publicHost = normalizeTenantHostname(new URL(appConfig.appUrl).host);
      container.set(CORE_PUBLIC_TENANCY_TOKEN, {
        resolveTenantId: async (hostname) => hostname === publicHost ? 1 : null,
      });
    }
    config.set(DATABASE_URL_CONFIG_KEY, appConfig.databaseUrl);
    config.set(APP_PORT_CONFIG_KEY, appConfig.port);
    config.set(REDIS_URL_CONFIG_KEY, process.env.REDIS_URL ?? "");
    config.set("app.url", appConfig.appUrl);
    config.set("cache.driver", process.env.CACHE_DRIVER ?? "${layers.cache}");
    config.set("cache.ttlMs", 3_600_000);
    config.set("cache.maxEntries", 100);
    config.set("queue.driver", process.env.QUEUE_DRIVER ?? "${layers.queue}");
  },
};

export default configProvider;
`;
}

function renderQueueProvider(): string {
  return `import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  createAppQueue,
  createFailedJobService,
  FAILED_JOB_SERVICE_TOKEN,
} from "@getstrata/core/queue/createAppQueue";

const queueProvider: ServiceProvider = {
  name: "starter.queue",
  async register({ container, onCleanup }) {
    const driver = (process.env.QUEUE_DRIVER ?? "sync") as "sync" | "async" | "redis";
    const failedJobs = createFailedJobService();
    container.set(FAILED_JOB_SERVICE_TOKEN, failedJobs);
    registerDefaultJobs();
    await discoverJobs();
    const queue = createAppQueue(driver, process.env.REDIS_URL, failedJobs);
    onCleanup(() => queue.close?.(), driver === "async" ? "drain" : "close");
    container.set(CORE_QUEUE_TOKEN, queue);
  },
};

export default queueProvider;
`;
}

function renderPolicyProvider(): string {
  return `import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { PolicyGate } from "@getstrata/core/auth/policy";
import type { ServiceProvider } from "@getstrata/core/contracts/di";

const policyProvider: ServiceProvider = {
  name: "core.policy",
  register({ container }) {
    container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  },
};

export default policyProvider;
`;
}

function renderProvidersIndex(): string {
  return `import { tracingProvider } from "@getstrata/bootstrap";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { registerInvalidateCacheOnModelWriteListeners } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import authProvider from "./auth.ts";
import cacheProvider from "./cache.ts";
import configProvider from "./config.ts";
import policyProvider from "./policy.ts";
import queueProvider from "./queue.ts";
import storageProvider from "./storage.ts";
import viewProvider from "./view.ts";

const listenersProvider: ServiceProvider = {
  name: "starter.listeners",
  async boot({ onCleanup }) {
    onCleanup(registerInvalidateCacheOnModelWriteListeners());

    for (const registerListener of await discoverListeners()) {
      await registerListener();
    }
  },
};

const starterProviders: ServiceProvider[] = [
  configProvider,
  tracingProvider,
  cacheProvider,
  storageProvider,
  queueProvider,
  authProvider,
  viewProvider,
  policyProvider,
  listenersProvider,
];

export { starterProviders };
`;
}

function renderCreateAppTs(layers: StarterLayers): string {
  const ensureLine = needsEnsure(layers)
    ? `import { ensureAppDatabase } from "./ensureDatabase.ts";\n`
    : "";
  const metricsImport = layers.extras.metrics
    ? `import { createMetricsRoutes, createMetricsRuntime, type MetricsRuntime, type MetricsRuntimeOptions } from "@getstrata/bootstrap/metricsRoutes";\n`
    : "";
  const metricsSpread = layers.extras.metrics
    ? "\n    ...createMetricsRoutes(metricsRuntime?.options),"
    : "";
  return `import { join } from "node:path";
import "./preload.ts";
import { createAppContext as createProviderAppContext, type InitializedAppContext } from "@getstrata/bootstrap/context";
import type { AppRouteMap } from "@getstrata/bootstrap/contracts";
import { mergeSpaRoutes } from "@getstrata/bootstrap/createSpaRoutes";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import {
  configureModulesDirectory,
  discoverModules,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
${metricsImport}import { assertProductionSecrets, assertRlsLiveDatabaseRole } from "@getstrata/bootstrap/secretsGuard";
import { createWebServer, type NativeServerOptions } from "@getstrata/bootstrap/web/server";
import type { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { isRlsTenancy } from "@getstrata/core/tenant/tenancyConfig";
import { migrate } from "../db/migrate.ts";
import { buildRoutes } from "../routes.ts";
import { Note } from "../models/Note.ts";
import { loadConfig } from "./config.ts";
import { closeDatabase, getSql, pingDatabase } from "./database.ts";
${ensureLine}import { starterProviders } from "./providers/index.ts";

export interface BootstrapOptions {
  /** Automatic migrations and local database provisioning; false uses existing infrastructure. */
  migrate?: boolean;${layers.extras.metrics ? "\n  /** Explicit opt-in; HTTP-only metrics remain the default. */\n  runtimeMetrics?: MetricsRuntimeOptions;" : ""}
}

export interface BootstrappedApp {
  context: InitializedAppContext;
  routes: AppRouteMap;
  config: ReturnType<typeof loadConfig>;
}

async function createAppContext(${layers.extras.metrics ? "metricsRuntime?: MetricsRuntime" : ""}): Promise<InitializedAppContext> {
  await ensureModulesLoaded();
  const moduleProviders = discoverModules().flatMap((module) => module.providers ?? []);
${
  layers.extras.metrics
    ? `  const metricsProviders = metricsRuntime ? [{
    name: "starter.runtime-metrics",
    register({ onCleanup }: import("@getstrata/core/contracts/di").ProviderContext) {
      onCleanup(() => metricsRuntime.close(), "drain");
    },
  }] : [];
`
    : ""
}  return createProviderAppContext([...starterProviders, ...moduleProviders${layers.extras.metrics ? ", ...metricsProviders" : ""}]);
}

export async function bootstrapApp(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
  let context: InitializedAppContext | undefined;${layers.extras.metrics ? "\n  let metricsRuntime: MetricsRuntime | undefined;" : ""}
  try {
    const isProduction = isProductionEnv();
    // Dev boots migrate for convenience. Production must not mutate schema on
    // start, so run \`strata migrate\` as an explicit deploy step instead.
    const { migrate: runMigrate = !isProduction } = options;

    if (isProduction) {
      assertProductionSecrets();
    }

${needsEnsure(layers) ? "    await ensureAppDatabase({ provision: !isProduction && runMigrate });\n" : ""}    const appConfig = loadConfig();
    getSql();
    if (!(await pingDatabase())) throw new Error("Database is not ready.");
    if (isRlsTenancy()) {
      await assertRlsLiveDatabaseRole();
    }
    configureModulesDirectory(join(import.meta.dir, "../modules"));
    await ensureModulesLoaded();
${layers.extras.metrics ? "    metricsRuntime = createMetricsRuntime(options.runtimeMetrics);\n" : ""}    context = await createAppContext(${layers.extras.metrics ? "metricsRuntime" : ""});

    if (runMigrate) {
      await migrate();
    }

    const documentKernel = createHttpKernel(context.dependencies);
    const routes = mergeSpaRoutes(context.dependencies, {
      ...createHealthRoutes(context.dependencies, {
        pingOnHealth: true,
        healthFormat: "text",
        schemaCheck: async () => {
          // Infrastructure probe: no tenant selection, bypass, user data or writes.
          try { await Note.query().limit(1).select("id").get(); return true; }
          catch { return false; }
        },
      }),
      ...buildRoutes(context.dependencies),${metricsSpread}
    }, {
      distDirectory: join(import.meta.dir, "../../frontend/dist"),
      wrap: (handler) => documentKernel.wrapPublicDocument(handler),
    });

    return { context, routes, config: appConfig };
  } catch (error) {
    const failures: unknown[] = [];
    for (const cleanup of [() => context?.dispose(), ${layers.extras.metrics ? "() => metricsRuntime?.close(), " : ""}closeDatabase]) {
      try { await cleanup(); } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], "Application startup and cleanup failed.", { cause: error });
    throw error;
  }
}

export async function createApp(options: BootstrapOptions = {}) {
  return bootstrapApp({ migrate: false, ...options });
}

export function createAppServer(routes: AppRouteMap, port = 0, lifecycle?: LifecycleCoordinator, native?: NativeServerOptions) {
  return createWebServer({
    port,
    publicDir: "./public",
    lifecycle,
    native,
    routes,
  });
}

export { createAppContext };
`;
}

function renderRoutesTs(): string {
  return `import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";

export function buildRoutes(dependencies: AppDependencies): AppRouteMap {
  const api = buildModuleRoutes(dependencies);
  return {
    ...api,
    ...(isViewsEnabled() ? buildWebModuleRoutes(dependencies, { clearRegistry: false }) : {}),
  };
}
`;
}

function renderOutboxRegistryTs(): string {
  return `import type { DurableListener } from "@getstrata/core/events/outbox";

/** Add listeners before publishing. An empty registry can run, and publish rejects unknown events. */
const listeners: readonly DurableListener[] = [];

export { listeners };
`;
}

function renderScheduleTs(): string {
  return `import { appSchedule } from "@getstrata/core/scheduler/schedule";

export { appSchedule };
`;
}

function renderViewProvider(layers: StarterLayers): string {
  return `import { join } from "node:path";
import { createViewProvider } from "@getstrata/bootstrap/providers/view";

export default createViewProvider({${layers.extras.mfa && htmlAuthKit(layers.auth) && (layers.frontend === "api" || layers.frontend === "spa-react") ? "\n  enabled: true," : ""}
  directory: join(import.meta.dir, "../../../views"),
  data: {
    userKey: "currentUser",${
      layers.extras.oidc
        ? `
    extra: () => ({
      oidcLogin: process.env.FEATURE_OAUTH === "true" &&
        Boolean(process.env.OIDC_CLIENT_ID?.trim() && process.env.OIDC_CLIENT_SECRET?.trim()),
    }),`
        : ""
    }
  },
});
`;
}

export {
  renderConfigProvider,
  renderConfigTs,
  renderCreateAppTs,
  renderOutboxRegistryTs,
  renderPolicyProvider,
  renderPreloadTs,
  renderProvidersIndex,
  renderQueueProvider,
  renderRoutesTs,
  renderScheduleTs,
  renderViewProvider,
};
