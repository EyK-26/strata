import { join } from "node:path";
import { CORE_CACHE_TOKEN, CORE_QUEUE_TOKEN } from "@getstrata/bootstrap/config";
import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { createEventBindings, createEventsProvider } from "@getstrata/bootstrap/providers/events";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { createAuditExporter } from "@getstrata/core/audit/exportAuditLogs";
import { establishedAuthReader } from "@getstrata/core/auth/authReader";
import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";
import {
  createCacheStore,
  snapshotCacheStoreOptions,
} from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import {
  resourceService,
  type ServiceDeclaration,
  service,
  valueService,
} from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import type { Queue } from "@getstrata/core/queue";
import {
  createAppQueue,
  createSystemQueueServices,
  FAILED_JOB_SERVICE_TOKEN,
  type QueueServices,
} from "@getstrata/core/queue/createAppQueue";
import { JobRegistry, QUEUE_JOB_REGISTRY_TOKEN } from "@getstrata/core/queue/jobRegistry";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import {
  createStorageDriver,
  resolveStorageConfig,
  StorageManager,
} from "@getstrata/core/storage/storage";
import { normalizeTenantHostname } from "@getstrata/core/tenant/tenantMiddleware";
import type { AppDefinition, ApplicationAuthServices } from "../application";
import {
  APP_PORT_CONFIG_KEY,
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_TOKEN,
  CORE_CONFIG_TOKEN,
  CORE_PUBLIC_TENANCY_TOKEN,
  CSRF_TARGET_ORIGIN_CONFIG_KEY,
  DATABASE_URL_CONFIG_KEY,
  REDIS_URL_CONFIG_KEY,
} from "../config";
import policyProvider from "../providers/policy";
import { createTracingProvider } from "../providers/tracing";
import { createViewProvider } from "../providers/view";
import { loadApplicationConfig } from "./config";

export const APPLICATION_STORAGE = createServiceToken<StorageManager>("starter.storage");
export const APPLICATION_CACHE = createServiceToken<CacheRepository>("starter.cache");
export const APPLICATION_QUEUE = createServiceToken<Queue>("starter.queue");
export const APPLICATION_QUEUE_SERVICES =
  createServiceToken<QueueServices>("starter.queueServices");
export const APPLICATION_AUDIT_EXPORT =
  createServiceToken<() => Promise<number>>("starter.auditExporter");
export const APPLICATION_BILLING =
  createServiceToken<Readonly<{ enabled: boolean; stripeSecret: string }>>(
    "starter.billing.options",
  );
export const APPLICATION_WEBHOOKS =
  createServiceToken<Readonly<{ allowPrivate: boolean; signatureHeader: string }>>(
    "starter.webhook.options",
  );
export function createApplicationServices(
  env: Readonly<Record<string, string | undefined>>,
  invoke: import("@getstrata/core/contracts/persistence").PersistenceInvocation,
): readonly ServiceDeclaration[] {
  const storageConfig = resolveStorageConfig(env);
  const cacheOptions = snapshotCacheStoreOptions({
    driver: (env.CACHE_DRIVER ?? "array") as "array" | "redis",
    ttlMs: 3600000,
    maxEntries: 100,
    redisUrl: env.REDIS_URL,
    namespace: (env.APP_KEY_PREFIX?.trim() || "strata") + ":cache:v3:",
  });
  const driver = (env.QUEUE_DRIVER ?? "sync") as "sync" | "async" | "redis";
  if (!["sync", "async", "redis"].includes(driver))
    throw new TypeError("Unsupported queue driver.");
  return Object.freeze([
    ...createEventBindings(),
    valueService(QUEUE_JOB_REGISTRY_TOKEN, new JobRegistry()),
    service(APPLICATION_STORAGE, {
      lifetime: "application",
      dependencies: [] as const,
      create: () => new StorageManager(createStorageDriver(storageConfig)),
    }),
    valueService(
      APPLICATION_BILLING,
      Object.freeze({
        enabled: env.FEATURE_BILLING === "true",
        stripeSecret: env.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
      }),
    ),
    service(APPLICATION_AUDIT_EXPORT, {
      lifetime: "application",
      dependencies: [] as const,
      create: () =>
        createAuditExporter({
          environment: env,
          runSql: (work) =>
            invoke(
              { kind: "command", actor: { kind: "system", policy: "audit.export" } },
              ({ database, policy }) =>
                env.TENANCY_DRIVER === "rls"
                  ? policy.run(database, { kind: "bypass" }, work)
                  : database.transaction(work),
            ),
        }),
    }),
    service(APPLICATION_QUEUE_SERVICES, {
      lifetime: "application",
      dependencies: [APPLICATION_CACHE, APPLICATION_AUDIT_EXPORT] as const,
      create: (cache, auditExport) => createSystemQueueServices(invoke, { cache, auditExport }),
    }),
    valueService(
      APPLICATION_WEBHOOKS,
      Object.freeze({
        allowPrivate: !isProductionEnv(env) && env.WEBHOOK_ALLOW_PRIVATE === "true",
        signatureHeader:
          env.WEBHOOK_SIGNATURE_HEADER?.trim() ||
          "x-" + (env.APP_KEY_PREFIX?.trim() || "strata") + "-signature",
      }),
    ),
    resourceService(APPLICATION_CACHE, {
      lifetime: "application",
      dependencies: [] as const,
      create: () => ({
        name: "starter.cache",
        open: () => ({ ok: true, value: new CacheRepository(createCacheStore(cacheOptions)) }),
        close: (cache) => cache.close(),
      }),
    }),
    resourceService(APPLICATION_QUEUE, {
      lifetime: "application",
      dependencies: [APPLICATION_QUEUE_SERVICES, QUEUE_JOB_REGISTRY_TOKEN] as const,
      create: (services, registry) => ({
        name: "starter.queue",
        open: () => ({
          ok: true,
          value: createAppQueue(driver, env.REDIS_URL, services, registry),
        }),
        drain: (queue) => (driver === "async" ? queue.close?.() : undefined),
        close: (queue) => (driver !== "async" ? queue.close?.() : undefined),
      }),
    }),
  ]);
}
export function createApplicationProviders<A extends ApplicationAuthServices>(
  definition: AppDefinition<A>,
  env: Readonly<Record<string, string | undefined>>,
  auth: A,
  cache: CacheRepository,
  queue: Queue,
  queueServices: QueueServices,
  events: import("@getstrata/core/events").EventBus,
  billing: Readonly<{ enabled: boolean; stripeSecret: string }>,
  storage: StorageManager,
  registry: JobRegistry,
): readonly ServiceProvider[] {
  const appConfig = loadApplicationConfig(env);
  return Object.freeze([
    createConfigProvider(appConfig, env),
    {
      name: "starter.billing-config",
      register({ container }) {
        container.set(APPLICATION_BILLING, billing);
      },
    },
    createTracingProvider({ env }),
    {
      name: "starter.cache",
      register({ container, dependencies }) {
        container.set(CORE_CACHE_TOKEN, cache);
        dependencies.cache = cache;
      },
    },
    {
      name: "application.storage",
      register({ dependencies }) {
        dependencies.storage = storage;
      },
    },
    {
      name: "starter.queue",
      async register({ container }) {
        container.set(CORE_QUEUE_TOKEN, queue);
        container.set(FAILED_JOB_SERVICE_TOKEN, queueServices);
        container.set(QUEUE_JOB_REGISTRY_TOKEN, registry);
        registerDefaultJobs(registry);
        await discoverJobs(registry, { directory: join(definition.root, "src/jobs") });
      },
    },
    {
      name: "application.auth",
      register({ container }) {
        container.set(definition.auth.token, auth);
        container.set(CORE_AUTH_TOKEN, establishedAuthReader);
        container.set(CORE_ABILITY_CHECKER_TOKEN, createTokenAbilityChecker());
      },
    },
    createViewProvider({
      env,
      enabled: definition.views ?? ["server-htmx", "hybrid"].includes(definition.frontend),
      directory: join(definition.root, "views"),
      data: {
        userKey: "currentUser",
        loadUser: async (_container, request) => {
          const user = await establishedAuthReader.user(request);
          return user
            ? {
                id: Number(user.id),
                name: user.name ?? "",
                email: user.email ?? "",
                role: user.role ?? "member",
              }
            : null;
        },
        extra: {
          appName: env.APP_NAME?.trim() || "Strata",
          oidcLogin:
            env.FEATURE_OAUTH === "true" &&
            Boolean(env.OIDC_CLIENT_ID?.trim() && env.OIDC_CLIENT_SECRET?.trim()),
        },
      },
    }),
    policyProvider,
    createEventsProvider(events),
  ]);
}

function createConfigProvider(
  appConfig: ReturnType<typeof loadApplicationConfig>,
  env: Readonly<Record<string, string | undefined>>,
): ServiceProvider {
  return {
    name: "application.config",
    register({ container, config }) {
      container.set(CORE_CONFIG_TOKEN, config);
      if (env.CSRF_TARGET_ORIGIN !== undefined)
        config.set(CSRF_TARGET_ORIGIN_CONFIG_KEY, env.CSRF_TARGET_ORIGIN);
      if (isProductionEnv(env)) {
        const publicHost = normalizeTenantHostname(new URL(appConfig.appUrl).host);
        container.set(CORE_PUBLIC_TENANCY_TOKEN, {
          resolveTenantId: async (hostname) => (hostname === publicHost ? 1 : null),
        });
      }
      config.set(DATABASE_URL_CONFIG_KEY, appConfig.databaseUrl);
      config.set(APP_PORT_CONFIG_KEY, appConfig.port);
      config.set(REDIS_URL_CONFIG_KEY, env.REDIS_URL ?? "");
      config.set("app.url", appConfig.appUrl);
      config.set("app.debug", env.APP_DEBUG === "true");
      config.set("cache.driver", env.CACHE_DRIVER ?? "array");
      config.set("cache.ttlMs", 3600000);
      config.set("cache.maxEntries", 100);
      config.set("queue.driver", env.QUEUE_DRIVER ?? "sync");
    },
  };
}
