import { join, resolve } from "node:path";
import { createApplicationContext, type InitializedAppContext } from "@getstrata/bootstrap/context";
import {
  type AppRouteMap,
  assertAppDependenciesComplete,
  type ServiceProvider,
} from "@getstrata/bootstrap/contracts";
import { mergeSpaRoutes } from "@getstrata/bootstrap/createSpaRoutes";
import { createDatabaseReadinessBindings } from "@getstrata/bootstrap/databaseReadiness";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { createModelCacheInvalidationEffects } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import {
  createMetricsRoutes,
  createMetricsRuntime,
  type MetricsRuntime,
  type MetricsRuntimeOptions,
} from "@getstrata/bootstrap/metricsRoutes";
import { resolveHttpResponsePolicy } from "@getstrata/bootstrap/providers";
import { APPLICATION_EVENT_BUS_TOKEN } from "@getstrata/bootstrap/providers/events";
import { composeRouteMaps } from "@getstrata/bootstrap/routePlan";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { type NativeServerOptions, webServerResource } from "@getstrata/bootstrap/web/server";
import {
  ADMIN_ABILITIES,
  MEMBER_ABILITIES,
  resolveAbilitiesForRole,
} from "@getstrata/core/auth/abilityCatalog";
import { intendedUrlCookieOptionsFromEnvironment } from "@getstrata/core/auth/intendedUrlCookie";
import { createScimAuthenticator } from "@getstrata/core/auth/scimAuthMiddleware";
import { clearSessionCookie } from "@getstrata/core/auth/sessionCookie";
import type { Application, ProviderDefinition } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import {
  CORE_POLICY_REGISTRY_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/core/contracts/serviceTokens";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import type { DatabaseDefinition } from "@getstrata/core/database/bindings";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { createOwnedReadOnlyObservation } from "@getstrata/core/database/ownedReadOnlyObservation";
import type { DatabaseConnectionOptions } from "@getstrata/core/database/session";
import type { DurableListener } from "@getstrata/core/events/outbox";
import {
  createOutboxWorkerTransport,
  createSqlOutboxBindings,
  type SqlOutbox,
} from "@getstrata/core/events/outbox";
import { csrfTokenOptionsFromEnvironment } from "@getstrata/core/http/csrfToken";
import { flashSessionOptionsFromEnvironment } from "@getstrata/core/http/flashSession";
import type { QueueServices } from "@getstrata/core/queue/createAppQueue";
import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import { type JobRegistry, QUEUE_JOB_REGISTRY_TOKEN } from "@getstrata/core/queue/jobRegistry";
import { resolveQueueConfig, resolveQueueRuntimeConfig } from "@getstrata/core/queue/queueConfig";
import { createQueueWorkerTransport } from "@getstrata/core/queue/queueWorkerTransport";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { defineProvider } from "@getstrata/core/runtime/application";
import {
  FRONTEND_MODES,
  type FrontendMode,
  isSpaMode,
  isViewsMode,
  validateSpaPrefix,
} from "@getstrata/core/runtime/frontendMode";
import { resolveScimTenantFromToken } from "@getstrata/core/security/scimTenantTokens";
import { resolveTenant } from "@getstrata/core/tenant/resolveTenant";
import type { WebErrorView } from "@getstrata/core/view";
import { CORE_WEB_ERROR_VIEW_TOKEN } from "@getstrata/core/view/tokens";
import type { Server } from "bun";
import { loadApplicationConfig } from "./application/config";
import {
  APPLICATION_AUDIT_EXPORT,
  APPLICATION_BILLING,
  APPLICATION_CACHE,
  APPLICATION_QUEUE,
  APPLICATION_QUEUE_SERVICES,
  APPLICATION_STORAGE,
  createApplicationProviders,
  createApplicationServices,
} from "./application/services";
import { buildModuleRoutes } from "./buildModuleRoutes";
import { buildWebModuleRoutes } from "./buildWebModuleRoutes";
import type { AppModule } from "./contracts";
import type { HttpPersistenceOptions } from "./persistenceContracts";
import type { MetadataAuthOptions } from "./providers/auth";

export interface BootstrapOptions {
  migrate?: boolean;
  transports?: readonly import("@getstrata/core/contracts/application").TransportDefinition[];
  providers?: readonly ProviderDefinition[];
  services?: readonly import("@getstrata/core/contracts/services").ServiceDeclaration[];
  persistence?: Pick<
    import("@getstrata/core/database/bindings").DatabaseDefinition,
    "repositories" | "models" | "repositoryEffects"
  >;
  mode?: "http" | "command" | "worker" | "outbox-worker";
  server?: { port?: number; native?: NativeServerOptions };
  onConstructed?: (application: Application) => undefined;
  runtimeMetrics?: Omit<MetricsRuntimeOptions, "failedJobs" | "outbox"> & {
    failedJobs?: Omit<NonNullable<MetricsRuntimeOptions["failedJobs"]>, "observeReadOnly">;
    outbox?: Omit<NonNullable<MetricsRuntimeOptions["outbox"]>, "observeReadOnly">;
  };
}
export interface BootstrappedApp {
  application: Application;
  auditExport: () => Promise<number>;
  invoke: PersistenceInvocation;
  readonly outbox: Readonly<Pick<SqlOutbox, "publish">>;
  context: InitializedAppContext;
  routes: AppRouteMap;
  config: ReturnType<typeof loadApplicationConfig>;
  queue: import("@getstrata/core/queue").QueueDispatcher;
  queueServices: import("@getstrata/core/queue/createAppQueue").QueueServices;
  registry: JobRegistry;
  server?: Server<unknown>;
  worker?: ReturnType<typeof createQueueWorkerTransport>;
  outboxWorker?: ReturnType<typeof createOutboxWorkerTransport>;
}
/** Application-owned choices. Pools, transports and lifecycle assembly stay in the package. */
export interface ApplicationAuthServices {
  readonly metadata: HttpPersistenceOptions["metadata"];
  readonly config: {
    readonly signatureSecret: string;
    readonly sessionCookie: { readonly cookieName: string; readonly production: boolean };
    readonly passwordConfirmation: NonNullable<HttpPersistenceOptions["passwordConfirmation"]>;
  };
}
export type ApplicationAuthOptions = Omit<
  MetadataAuthOptions,
  "mechanisms" | "sessionGuard" | "mfaSecrets"
> & {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly sessionSecret?: string;
  readonly signatureSecret?: string;
};
export interface AppDefinition<A extends ApplicationAuthServices> {
  readonly root: string;
  readonly database: (
    env: Readonly<Record<string, string | undefined>>,
  ) => DatabaseConnectionOptions;
  readonly auth: {
    readonly create: (options: ApplicationAuthOptions) => A;
    readonly token: ServiceToken<A>;
  };
  readonly models: NonNullable<DatabaseDefinition["models"]>;
  readonly repositories: NonNullable<DatabaseDefinition["repositories"]>;
  readonly migrate: (environment?: Readonly<Record<string, string | undefined>>) => Promise<void>;
  readonly ensureDatabase?: (options: {
    provision: boolean;
    environment?: Readonly<Record<string, string | undefined>>;
  }) => Promise<unknown>;
  readonly routes?: (
    dependencies: import("./contracts").AppDependencies,
    modules: readonly AppModule[],
    options: { frontend: FrontendMode },
  ) => AppRouteMap;
  readonly outbox: {
    readonly listeners: readonly DurableListener[];
    readonly token?: ServiceToken<Readonly<Pick<SqlOutbox, "publish">>>;
  };
  readonly tenancy: "none" | "column" | "rls";
  readonly frontend: "api" | "spa-react" | "server-htmx" | "hybrid";
  readonly views?: boolean;
  readonly scim?: boolean;
  readonly metrics?: boolean;
  readonly health?: (
    database: import("@getstrata/core/database/session").DatabaseSession,
  ) => Promise<boolean>;
  readonly modulesDirectory?: string;
  readonly defaults?: Readonly<Record<string, string | undefined>>;
  readonly providers?: readonly ProviderDefinition[];
}

export function defineApp<A extends ApplicationAuthServices>(input: AppDefinition<A>) {
  const definition = Object.freeze({
    ...input,
    root: resolve(input.root),
    auth: Object.freeze({ ...input.auth }),
    models: Object.freeze([...input.models]),
    repositories: Object.freeze([...input.repositories]),
    outbox: Object.freeze({
      ...input.outbox,
      listeners: Object.freeze([...input.outbox.listeners]),
    }),
    defaults: Object.freeze({ ...input.defaults }),
    providers: Object.freeze([...(input.providers ?? [])]),
  });
  const repositoryDefinitions = definition.repositories;
  const modelDefinitions = definition.models;
  const durableListeners = definition.outbox.listeners;
  const migrate = definition.migrate;
  const buildRoutes = definition.routes ?? buildApplicationRoutes;
  const databaseOptions = definition.database;
  function bootstrapApp(
    options: BootstrapOptions & { mode: "outbox-worker" },
  ): Promise<BootstrappedApp & { outboxWorker: ReturnType<typeof createOutboxWorkerTransport> }>;
  function bootstrapApp(options?: BootstrapOptions): Promise<BootstrappedApp>;
  async function bootstrapApp(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
    const defaults = { ...definition.defaults };
    const supplied = { ...process.env };
    if (supplied.APP_DATABASE_URL || supplied.DATABASE_URL) delete defaults.MIGRATION_DATABASE_URL;
    if (isProductionEnv(supplied)) {
      delete defaults.DATABASE_URL;
      delete defaults.MIGRATION_DATABASE_URL;
    }
    const frontend = supplied.FRONTEND_MODE ?? defaults.FRONTEND_MODE ?? definition.frontend;
    if (!FRONTEND_MODES.includes(frontend as FrontendMode))
      throw new TypeError("Unsupported FRONTEND_MODE.");
    if (supplied.TENANCY_DRIVER && supplied.TENANCY_DRIVER !== definition.tenancy)
      throw new TypeError(
        "TENANCY_DRIVER must match the application's schema tenancy configuration.",
      );
    const env: Readonly<Record<string, string | undefined>> = Object.freeze({
      ...defaults,
      ...supplied,
      FRONTEND_MODE: frontend,
      TENANCY_DRIVER: definition.tenancy,
    });
    const queueRuntime = resolveQueueRuntimeConfig(env);
    const retryPolicy = resolveQueueConfig(env);
    const production = isProductionEnv(env);
    const runMigrate = options.migrate ?? !production;
    if (production) assertProductionSecrets(env);
    const config = loadApplicationConfig(env);
    const dbOptions = databaseOptions(env);
    const mode = options.mode ?? "command";
    if (mode === "worker" && !env.REDIS_URL) throw new Error("queue:work requires REDIS_URL.");
    const secret = env.SESSION_SECRET?.trim() ?? "";
    const abilities = Object.freeze({
      admin: ADMIN_ABILITIES,
      member: MEMBER_ABILITIES,
      resolveForRole: resolveAbilitiesForRole,
    });
    const auth = definition.auth.create({
      environment: env,
      production,
      allowDevHeaders: !production && env.AUTH_DEV_HEADERS === "true",
      jwtSecret: env.JWT_SECRET?.trim() || secret,
      sessionSecret: secret,
      signatureSecret:
        env.SIGNED_URL_SECRET?.trim() || secret || env.OAUTH_STATE_SECRET?.trim() || "",
      readSession: () => null,
      abilities,
      roleAbilities: (role) => [...(role === "admin" ? abilities.admin : abilities.member)],
    });
    await definition.ensureDatabase?.({ provision: !production && runMigrate, environment: env });
    // Schema commands finish and close their own separate resources before runtime starts.
    if (runMigrate) await migrate(env);
    const modules = await ensureModulesLoaded({
      modulesDir: resolve(definition.root, definition.modulesDirectory ?? "src/modules"),
    });
    const listenerDeclarations = await discoverListeners({
      directory: join(definition.root, "src/listeners"),
    });
    const cacheEffects = createModelCacheInvalidationEffects(repositoryDefinitions, modules, {
      cache: APPLICATION_CACHE,
      queue: APPLICATION_QUEUE,
    });
    const catalog = [cacheEffects, ...listenerDeclarations];
    let invoke: PersistenceInvocation | undefined;
    let auditExport: (() => Promise<number>) | undefined;
    const run: PersistenceInvocation = (envelope, work) => {
      if (!invoke) throw new Error("Application owner has not been constructed.");
      return invoke(envelope, work);
    };
    let readyQueueServices: QueueServices | undefined;
    let readyRegistry: JobRegistry | undefined;
    const selectedRegistry = () => {
      if (!readyRegistry) throw new Error("Job registry is not assembled.");
      return readyRegistry;
    };
    const selectedQueueServices = () => {
      if (!readyQueueServices) throw new Error("Queue services are not assembled.");
      return readyQueueServices;
    };
    const queueServices: Pick<QueueServices, "recordFailure" | "runAttempt"> = {
      recordFailure: (...args) => selectedQueueServices().recordFailure(...args),
      runAttempt: (...args) => selectedQueueServices().runAttempt(...args),
    };
    const outbox = createSqlOutboxBindings({
      invoke: run,
      connection: "main",
      tenancy: definition.tenancy,
      listeners: durableListeners,
    });
    let publisher: BootstrappedApp["outbox"] | undefined;
    const worker =
      mode === "worker"
        ? createQueueWorkerTransport({
            redisUrl: env.REDIS_URL!,
            queueServices,
            registry: selectedRegistry,
            runtime: queueRuntime,
            retryPolicy,
          })
        : undefined;
    const outboxWorker =
      mode === "outbox-worker" ? createOutboxWorkerTransport(outbox.token) : undefined;
    let server: Server<unknown> | undefined;
    let routes: AppRouteMap | undefined;
    let errorView: WebErrorView | undefined;
    let kernel: ReturnType<typeof createHttpKernel> | undefined;
    let metrics: MetricsRuntime | undefined;
    const assembly: ServiceProvider = {
      name: "starter.routes",
      async boot({ dependencies, onCleanup }) {
        assertAppDependenciesComplete(dependencies);
        kernel = createHttpKernel(dependencies);
        errorView = dependencies.container.has(CORE_WEB_ERROR_VIEW_TOKEN)
          ? dependencies.container.resolve(CORE_WEB_ERROR_VIEW_TOKEN)
          : undefined;
        const { failedJobs, outbox, ...runtime } = options.runtimeMetrics ?? {};
        if (definition.metrics)
          metrics = createMetricsRuntime({
            ...runtime,
            ...(failedJobs
              ? {
                  failedJobs: {
                    ...failedJobs,
                    observeReadOnly: createOwnedReadOnlyObservation(
                      handle.application,
                      "main",
                      dbOptions,
                    ),
                  },
                }
              : {}),
            ...(outbox
              ? {
                  outbox: {
                    ...outbox,
                    observeReadOnly: createOwnedReadOnlyObservation(
                      handle.application,
                      "main",
                      dbOptions,
                      { postgresPolicy: "bypass" },
                    ),
                  },
                }
              : {}),
          });
        if (metrics) onCleanup(() => metrics!.close(), "drain");
        routes = mergeSpaRoutes(
          dependencies,
          composeRouteMaps(
            Object.fromEntries(
              Object.entries(
                createHealthRoutes(dependencies, {
                  pingOnHealth: true,
                  healthFormat: "text",
                  schemaCheck: () =>
                    dependencies.invoke(
                      { kind: "request", actor: { kind: "system", policy: "http.schema-health" } },
                      async ({ database }) => {
                        try {
                          return definition.health ? await definition.health(database) : true;
                        } catch {
                          return false;
                        }
                      },
                    ),
                }),
              ).map(([path, handler]) => [path, kernel!.wrapPublicDocument(handler)]),
            ),
            buildRoutes(dependencies, modules, { frontend: frontend as FrontendMode }),
            ...(definition.metrics
              ? [
                  Object.fromEntries(
                    Object.entries(
                      createMetricsRoutes({
                        ...metrics?.options,
                        authorization: { token: env.METRICS_TOKEN, production },
                      }),
                    ).map(([path, handler]) => [path, kernel!.wrapPublicDocument(handler)]),
                  ),
                ]
              : []),
          ),
          {
            enabled: isSpaMode(frontend as FrontendMode),
            viewsEnabled: isViewsMode(frontend as FrontendMode),
            prefix: validateSpaPrefix(env.SPA_PREFIX),
            distDirectory: join(definition.root, "frontend/dist"),
            wrap: (handler) => kernel!.wrapPublicDocument(handler),
          },
        );
      },
    };
    const handle = createApplicationContext([], {
      connection: "main",
      http: {
        metadata: auth.metadata,
        invalidSessionCookie: {
          name: auth.config.sessionCookie.cookieName,
          expiredHeader: clearSessionCookie(auth.config.sessionCookie),
        },
        responsePolicy: resolveHttpResponsePolicy(env),
        intendedUrl: intendedUrlCookieOptionsFromEnvironment(env),
        flash: flashSessionOptionsFromEnvironment(env),
        features: {
          emailVerificationRequired: env.FEATURE_EMAIL_VERIFICATION === "true",
          viewsEnabled: ["server-htmx", "hybrid"].includes(
            env.FRONTEND_MODE ?? definition.frontend,
          ),
          publicReadsEnabled: env.FEATURE_PUBLIC_READS === "true",
          etagEnabled: env.FEATURE_ETAG !== "false",
        },
        csrf: {
          token: csrfTokenOptionsFromEnvironment(env),
          allowDevelopmentHeaders: !production && env.AUTH_DEV_HEADERS === "true",
          samlAcsUrl: env.SAML_ACS_URL ?? "",
        },
        tenancy: definition.tenancy,
        production,
        allowTenantDevHeaders: !production && env.TENANT_DEV_HEADERS === "true",
        signatureSecret: auth.config.signatureSecret,
        passwordConfirmation: auth.config.passwordConfirmation,
        ...(production
          ? {
              publicTenancy: {
                resolveTenantId: async (host: string) =>
                  host === new URL(config.appUrl).hostname ? 1 : null,
              },
            }
          : {}),
        scim: definition.scim
          ? createScimAuthenticator({
              resolveToken: (token) => resolveScimTenantFromToken(token, env),
              resolveTenant,
            })
          : undefined,
      },
      onConstructed: (owner) => {
        invoke = owner.invoke;
        options.onConstructed?.(owner.application);
        return undefined;
      },
      providersFromScope: (scope) => {
        readyRegistry = scope.resolve(QUEUE_JOB_REGISTRY_TOKEN);
        auditExport = scope.resolve(APPLICATION_AUDIT_EXPORT);
        readyQueueServices = scope.resolve(APPLICATION_QUEUE_SERVICES);
        const coordinator = scope.resolve(outbox.token);
        const publish = coordinator.publish;
        publisher = Object.freeze({
          publish: (...args: Parameters<SqlOutbox["publish"]>) =>
            publish.call(coordinator, ...args),
        });
        return [
          ...createApplicationProviders(
            definition,
            env,
            auth,
            scope.resolve(APPLICATION_CACHE),
            scope.resolve(APPLICATION_QUEUE),
            scope.resolve(APPLICATION_QUEUE_SERVICES),
            scope.resolve(APPLICATION_EVENT_BUS_TOKEN),
            scope.resolve(APPLICATION_BILLING),
            scope.resolve(APPLICATION_STORAGE),
            selectedRegistry(),
            config,
          ),
          ...modules.flatMap((module) => module.providers ?? []),
          ...(definition.outbox.token
            ? ([
                {
                  name: "app.outbox",
                  register({ container }) {
                    container.set(definition.outbox.token!, publisher!);
                  },
                },
              ] satisfies ServiceProvider[])
            : []),
          {
            name: "app.policies",
            boot({ container }) {
              const registry = container.resolve(CORE_POLICY_REGISTRY_TOKEN);
              for (const module of modules)
                for (const [name, policy] of Object.entries(module.policies ?? {}))
                  registry.register(name, policy);
            },
          },
          assembly,
        ];
      },
      definition: {
        config: { application: { url: config.appUrl, production } },
        providers: [
          ...definition.providers,
          ...(options.providers ?? []),
          defineProvider({
            name: "starter.services",
            services: [
              ...(options.services ?? []),
              ...outbox.services,
              ...createApplicationServices(env, run, definition.root),
              ...createDatabaseReadinessBindings("main", env),
              ...catalog.flatMap((declaration) => declaration.services),
              ...createDatabaseBindings({
                default: "main",
                connections: { main: dbOptions },
                preparation: [outbox.token],
                repositories: [
                  ...repositoryDefinitions,
                  failedJobRepository,
                  ...(options.persistence?.repositories ?? []),
                ],
                models: [...modelDefinitions, ...(options.persistence?.models ?? [])],
                repositoryEffects: [
                  ...catalog.flatMap((declaration) => declaration.repositoryEffects),
                  ...(options.persistence?.repositoryEffects ?? []),
                ],
              }),
            ],
          }),
        ],
        transports: [
          ...(options.transports ?? []),
          ...(worker ? [worker.transport] : []),
          ...(outboxWorker ? [outboxWorker.transport] : []),
          ...(mode === "http"
            ? [
                {
                  name: "starter.http",
                  async setup(
                    scope: import("@getstrata/core/contracts/application").ProviderScope,
                  ) {
                    // Provider boot assembles routes before any transport setup.
                    server = await scope.acquire(
                      webServerResource({
                        env,
                        port: options.server?.port ?? config.port,
                        native: {
                          maxRequestBodySize: resolveHttpResponsePolicy(env).maxBodyBytes,
                          ...(config.hostname ? { hostname: config.hostname } : {}),
                          ...options.server?.native,
                        },
                        cors: resolveHttpResponsePolicy(env).cors,
                        routes: routes!,
                        errorView,
                        publicDir: join(definition.root, "public"),
                        enter: (request, handler) => kernel!.run(request, handler),
                      }),
                    );
                  },
                },
              ]
            : []),
        ],
      },
    });
    const context = await handle.start();
    try {
      if (!routes) throw new Error("Routes were not assembled.");
      if (!publisher) throw new Error("Outbox publisher was not assembled.");
      return {
        application: handle.application,
        auditExport: auditExport!,
        invoke: handle.invoke,
        outbox: publisher,
        context,
        routes,
        config,
        queue: context.container.resolve(CORE_QUEUE_TOKEN),
        queueServices: selectedQueueServices(),
        registry: selectedRegistry(),
        ...(server ? { server } : {}),
        ...(worker ? { worker } : {}),
        ...(outboxWorker ? { outboxWorker } : {}),
      };
    } catch (error) {
      await handle.application.stop({ reason: "STARTUP_FAILED" });
      throw error;
    }
  }
  function createApp(options: BootstrapOptions = {}) {
    return bootstrapApp({ migrate: false, ...options });
  }
  /** HTTP acquisition is declared before startup, never added to an already ready application. */
  function createAppServer(options: Omit<BootstrapOptions, "mode"> = {}) {
    return bootstrapApp({ ...options, mode: "http" });
  }

  return Object.freeze({ bootstrapApp, createApp, createAppServer });
}

/** The executable entrypoint owns signal wiring; applications declare only their server. */
export async function serveApplication(
  start: () => Promise<BootstrappedApp>,
): Promise<BootstrappedApp> {
  const app = await start();
  if (!app.server) {
    await app.application.stop({ reason: "HTTP_STARTUP_FAILED" });
    throw new Error("HTTP transport did not start.");
  }
  const { LifecycleCoordinator, installGracefulShutdownSignals } = await import(
    "@getstrata/core/lifecycle/gracefulShutdown"
  );
  const lifecycle = new LifecycleCoordinator();
  lifecycle.register(
    "application",
    async () => {
      const result = await app.application.stop({ reason: "SIGNAL" });
      if (!result.successful) throw new Error("Application shutdown did not complete cleanly.");
    },
    "stop",
  );
  installGracefulShutdownSignals(undefined, lifecycle);
  console.log(`Listening on ${app.server.url.origin} (APP_URL ${app.config.appUrl})`);
  return app;
}

export { CORE_QUEUE_TOKEN as APPLICATION_QUEUE } from "@getstrata/core/contracts/serviceTokens";
export {
  APPLICATION_BILLING,
  APPLICATION_WEBHOOKS,
} from "./application/services";

function buildApplicationRoutes(
  dependencies: import("./contracts").AppDependencies,
  modules: readonly AppModule[],
  options: { frontend: FrontendMode },
): AppRouteMap {
  return composeRouteMaps(
    ...(isViewsMode(options.frontend) ? [buildWebModuleRoutes(dependencies, { modules })] : []),
    buildModuleRoutes(dependencies, { modules }),
  );
}
