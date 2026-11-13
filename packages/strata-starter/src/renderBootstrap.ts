import { defaultDatabaseUrl, defaultMigrationDatabaseUrl } from "./databaseDefaults.ts";
import type { StarterFeaturePlan } from "./featurePlan.ts";

function renderPreloadTs(plan: StarterFeaturePlan, projectName: string): string {
  const layers = plan.layers;
  const fallback = defaultDatabaseUrl(layers, projectName);
  const migrationFallback = defaultMigrationDatabaseUrl(layers, projectName);
  const migrationLine = migrationFallback
    ? `process.env.MIGRATION_DATABASE_URL ??= ${JSON.stringify(migrationFallback)};\n`
    : "";

  const databaseDefaults = plan.decisions.ensureDatabase
    ? `if (!isProductionEnv()) {\n  process.env.DATABASE_URL ??= ${JSON.stringify(fallback)};\n  ${migrationLine.trim()}\n}\n`
    : `process.env.DATABASE_URL ??= ${JSON.stringify(fallback)};\n`;
  return `${plan.decisions.ensureDatabase ? 'import { isProductionEnv } from "@getstrata/core/runtime/appEnv";\n' : ""}

${databaseDefaults}process.env.FRONTEND_MODE ??= ${JSON.stringify(layers.frontend)};
process.env.SPA_PREFIX ??= ${JSON.stringify(layers.spaPrefix)};
process.env.CACHE_DRIVER ??= ${JSON.stringify(layers.cache)};
process.env.QUEUE_DRIVER ??= ${JSON.stringify(layers.queue)};
${plan.decisions.redisQueue ? 'process.env.QUEUE_REDIS_TRANSPORT ??= "streams";\n' : ""}process.env.MAIL_DRIVER ??= ${JSON.stringify(layers.mail)};
process.env.TENANCY_DRIVER ??= ${JSON.stringify(layers.tenancy)};
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

export function loadConfig(env:Readonly<Record<string,string|undefined>>=process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    port: Number(env.PORT ?? 3000),
    hostname: env.HOST?.trim() || undefined,
    appUrl: env.APP_URL ?? "http://localhost:3000",
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

function renderConfigProvider(plan: StarterFeaturePlan): string {
  const layers = plan.layers;
  return `import {
  APP_PORT_CONFIG_KEY,
  CORE_CONFIG_TOKEN,
  CORE_PUBLIC_TENANCY_TOKEN,
  CSRF_TARGET_ORIGIN_CONFIG_KEY,
  DATABASE_URL_CONFIG_KEY,
  REDIS_URL_CONFIG_KEY,
} from "@getstrata/bootstrap/config";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { normalizeTenantHostname } from "@getstrata/core/tenant/tenantMiddleware";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { loadConfig } from "../config.ts";

export function createConfigProvider(appConfig:ReturnType<typeof loadConfig>,env:Readonly<Record<string,string|undefined>>):ServiceProvider {
  return {
  name: "starter.config",
  register({ container, config }) {

    container.set(CORE_CONFIG_TOKEN, config);
    if (env.CSRF_TARGET_ORIGIN !== undefined)
      config.set(CSRF_TARGET_ORIGIN_CONFIG_KEY, env.CSRF_TARGET_ORIGIN);
    // One approved origin for the starter tenant. Multi-tenant apps replace this lookup.
    if (isProductionEnv(env)) {
      const publicHost = normalizeTenantHostname(new URL(appConfig.appUrl).host);
      container.set(CORE_PUBLIC_TENANCY_TOKEN, {
        resolveTenantId: async (hostname) => hostname === publicHost ? 1 : null,
      });
    }
    config.set(DATABASE_URL_CONFIG_KEY, appConfig.databaseUrl);
    config.set(APP_PORT_CONFIG_KEY, appConfig.port);
    config.set(REDIS_URL_CONFIG_KEY, env.REDIS_URL ?? "");
    config.set("app.url", appConfig.appUrl);
    config.set("cache.driver", env.CACHE_DRIVER ?? "${layers.cache}");
    config.set("cache.ttlMs", 3_600_000);
    config.set("cache.maxEntries", 100);
    config.set("queue.driver", env.QUEUE_DRIVER ?? "${layers.queue}");
  },
};

}
`;
}

function renderQueueProvider(): string {
  return `import type { ServiceProvider } from "@getstrata/core/contracts/di";
import type { Queue } from "@getstrata/core/queue";
import { FAILED_JOB_SERVICE_TOKEN, type QueueServices } from "@getstrata/core/queue/createAppQueue";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
/** Bridge graph-owned resources into transport module declarations; it never owns their shutdown. */
export function createQueueProvider(queue:Queue,services:QueueServices):ServiceProvider {
  return {name:"starter.queue",register({container}){container.set(CORE_QUEUE_TOKEN,queue);container.set(FAILED_JOB_SERVICE_TOKEN,services);}};
}
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
  return `import { createTracingProvider } from "@getstrata/bootstrap";
import { createEventBindings, createEventsProvider } from "@getstrata/bootstrap/providers/events";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { resourceService, valueService, service, type ServiceDeclaration } from "@getstrata/core/contracts/services";
import { createAuditExporter } from "@getstrata/core/audit/exportAuditLogs";
import { createCacheStore, snapshotCacheStoreOptions } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { createAppQueue, createSystemQueueServices, type QueueServices, FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/queue/createAppQueue";
import type { Queue } from "@getstrata/core/queue";
import { JobRegistry, QUEUE_JOB_REGISTRY_TOKEN } from "@getstrata/core/queue/jobRegistry";
import { CORE_CACHE_TOKEN, CORE_QUEUE_TOKEN } from "@getstrata/bootstrap/config";
import { createStarterAuthProvider, type StarterAuthServices } from "./auth.ts";
import { loadConfig } from "../config.ts";
import { createConfigProvider } from "./config.ts";
import { createStorageProvider } from "./storage.ts";
import { createStorageDriver, resolveStorageConfig, StorageManager } from "@getstrata/core/storage/storage";
import { createStarterViewProvider } from "./view.ts";
import policyProvider from "./policy.ts";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";

export const STARTER_STORAGE_TOKEN = createServiceToken<StorageManager>("starter.storage");
export const STARTER_CACHE_TOKEN = createServiceToken<CacheRepository>("starter.cache");
export const STARTER_QUEUE_TOKEN = createServiceToken<Queue>("starter.queue");
export const STARTER_QUEUE_SERVICES_TOKEN = createServiceToken<QueueServices>("starter.queueServices");
export const STARTER_AUDIT_EXPORT_TOKEN=createServiceToken<()=>Promise<number>>("starter.auditExporter");
export const STARTER_BILLING_OPTIONS_TOKEN=createServiceToken<Readonly<{enabled:boolean;stripeSecret:string}>>("starter.billing.options");
export const STARTER_WEBHOOK_OPTIONS_TOKEN = createServiceToken<Readonly<{allowPrivate:boolean;signatureHeader:string}>>("starter.webhook.options");
export function createStarterServices(env:Readonly<Record<string,string|undefined>>, invoke:import("@getstrata/core/contracts/persistence").PersistenceInvocation):readonly ServiceDeclaration[] {
  const storageConfig = resolveStorageConfig(env);
  const cacheOptions = snapshotCacheStoreOptions({driver:(env.CACHE_DRIVER??"array") as "array"|"redis",ttlMs:3600000,maxEntries:100,redisUrl:env.REDIS_URL,namespace:(env.APP_KEY_PREFIX?.trim()||"strata")+":cache:v3:"});
  const driver=(env.QUEUE_DRIVER??"sync") as "sync"|"async"|"redis";
  if(!["sync","async","redis"].includes(driver))throw new TypeError("Unsupported queue driver.");
  return Object.freeze([
    ...createEventBindings(),
    valueService(QUEUE_JOB_REGISTRY_TOKEN,new JobRegistry()),
    service(STARTER_STORAGE_TOKEN,{lifetime:"application",dependencies:[] as const,create:()=>new StorageManager(createStorageDriver(storageConfig))}),
    valueService(STARTER_BILLING_OPTIONS_TOKEN,Object.freeze({enabled:env.FEATURE_BILLING==="true",stripeSecret:env.STRIPE_WEBHOOK_SECRET?.trim()??""})),
    service(STARTER_AUDIT_EXPORT_TOKEN,{lifetime:"application",dependencies:[] as const,create:()=>createAuditExporter({environment:env,runSql:work=>invoke({kind:"command",actor:{kind:"system",policy:"audit.export"}},({database,policy})=>env.TENANCY_DRIVER==="rls"?policy.run(database,{kind:"bypass"},work):database.transaction(work))})}),
    service(STARTER_QUEUE_SERVICES_TOKEN,{lifetime:"application",dependencies:[STARTER_CACHE_TOKEN,STARTER_AUDIT_EXPORT_TOKEN] as const,create:(cache,auditExport)=>createSystemQueueServices(invoke,{cache,auditExport})}),
    valueService(STARTER_WEBHOOK_OPTIONS_TOKEN,Object.freeze({allowPrivate:!isProductionEnv(env)&&env.WEBHOOK_ALLOW_PRIVATE==="true",signatureHeader:env.WEBHOOK_SIGNATURE_HEADER?.trim()||"x-"+(env.APP_KEY_PREFIX?.trim()||"strata")+"-signature"})),
    resourceService(STARTER_CACHE_TOKEN,{lifetime:"application",dependencies:[] as const,create:()=>({name:"starter.cache",open:()=>({ok:true,value:new CacheRepository(createCacheStore(cacheOptions))}),close:cache=>cache.close()})}),
    resourceService(STARTER_QUEUE_TOKEN,{lifetime:"application",dependencies:[STARTER_QUEUE_SERVICES_TOKEN,QUEUE_JOB_REGISTRY_TOKEN] as const,create:(services,registry)=>({name:"starter.queue",open:()=>({ok:true,value:createAppQueue(driver,env.REDIS_URL,services,registry)}),drain:queue=>driver==="async"?queue.close?.():undefined,close:queue=>driver!=="async"?queue.close?.():undefined})}),
  ]);
}
export function createStarterProviders(env:Readonly<Record<string,string|undefined>>, auth:StarterAuthServices, cache:CacheRepository, queue:Queue, queueServices:QueueServices,events:import("@getstrata/core/events").EventBus,billing:Readonly<{enabled:boolean;stripeSecret:string}>,storage:StorageManager,registry:JobRegistry):readonly ServiceProvider[] {
  const appConfig=loadConfig(env);
  return Object.freeze([
    createConfigProvider(appConfig,env),
    {name:"starter.billing-config",register({container}){container.set(STARTER_BILLING_OPTIONS_TOKEN,billing);}},
    createTracingProvider({ env }),
    {name:"starter.cache",register({container,dependencies}){container.set(CORE_CACHE_TOKEN,cache);dependencies.cache=cache;}},
    createStorageProvider(storage),
    {name:"starter.queue",async register({container}){container.set(CORE_QUEUE_TOKEN,queue);container.set(FAILED_JOB_SERVICE_TOKEN,queueServices);container.set(QUEUE_JOB_REGISTRY_TOKEN,registry);registerDefaultJobs(registry);await discoverJobs(registry);}},
    createStarterAuthProvider(auth),createStarterViewProvider(env),policyProvider,createEventsProvider(events),
  ]);
}
`;
}

function renderCreateAppTs(plan: StarterFeaturePlan): string {
  const workTracker = plan.decisions.workTracker;
  const layers = plan.layers;
  const ensure = plan.decisions.ensureDatabase
    ? 'import { ensureAppDatabase } from "./ensureDatabase.ts";\n'
    : "";
  const metricsImports = layers.extras.metrics
    ? 'import { createMetricsRoutes, createMetricsRuntime, type MetricsRuntime, type MetricsRuntimeOptions } from "@getstrata/bootstrap/metricsRoutes";\nimport { createOwnedReadOnlyObservation } from "@getstrata/core/database/ownedReadOnlyObservation";\n'
    : "";
  return `import "./preload.ts";
${workTracker ? 'import { WORK_TRACKER_OUTBOX } from "../domain/workTracker.ts";\n' : ""}import { join } from "node:path";
import { createApplicationContext, type InitializedAppContext } from "@getstrata/bootstrap/context";
import { assertAppDependenciesComplete, type AppRouteMap, type ServiceProvider } from "@getstrata/bootstrap/contracts";
import type { Application } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { composeRouteMaps } from "@getstrata/bootstrap/routePlan";
import { createSqlOutboxBindings, createOutboxWorkerTransport, type SqlOutbox } from "@getstrata/core/events/outbox";
import { listeners as durableListeners } from "../outbox/registry.ts";
import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import type { QueueServices } from "@getstrata/core/queue/createAppQueue";
import { createQueueWorkerTransport } from "@getstrata/core/queue/queueWorkerTransport";
import { type JobRegistry, QUEUE_JOB_REGISTRY_TOKEN } from "@getstrata/core/queue/jobRegistry";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
import { mergeSpaRoutes } from "@getstrata/bootstrap/createSpaRoutes";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { createModelCacheInvalidationEffects } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { webServerResource, type NativeServerOptions } from "@getstrata/bootstrap/web/server";
import type { Server } from "bun";
import { abilityCatalog } from "@getstrata/core/auth/abilityCatalog";
import { csrfTokenOptionsFromEnvironment } from "@getstrata/core/http/csrfToken";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { createDatabaseReadinessBindings } from "@getstrata/bootstrap/databaseReadiness";
import { APPLICATION_EVENT_BUS_TOKEN } from "@getstrata/bootstrap/providers/events";
${layers.extras.scim ? 'import { createScimAuthenticator } from "@getstrata/core/auth/scimAuthMiddleware";\nimport { resolveScimTenantFromToken } from "@getstrata/core/security/scimTenantTokens";\nimport { resolveTenant } from "@getstrata/core/tenant/resolveTenant";\n' : ""}${metricsImports}import { createStarterAuthServices } from "./providers/auth.ts";
import { createStarterProviders, createStarterServices, STARTER_CACHE_TOKEN, STARTER_QUEUE_TOKEN, STARTER_QUEUE_SERVICES_TOKEN,STARTER_BILLING_OPTIONS_TOKEN,STARTER_AUDIT_EXPORT_TOKEN, STARTER_STORAGE_TOKEN } from "./providers/index.ts";
import { repositoryDefinitions, modelDefinitions } from "../models/register.ts";
import { Note } from "../models/Note.ts";
import { migrate } from "../db/migrate.ts";
import { buildRoutes } from "../routes.ts";
import { loadConfig } from "./config.ts";
import { databaseOptions } from "./database.ts";
${ensure}
export interface BootstrapOptions {
  migrate?:boolean;
  transports?:readonly import("@getstrata/core/contracts/application").TransportDefinition[];
  services?:readonly import("@getstrata/core/contracts/services").ServiceDeclaration[];
  persistence?:Pick<import("@getstrata/core/database/bindings").DatabaseDefinition,"repositories"|"models"|"repositoryEffects">;
  mode?:"http"|"command"|"worker"|"outbox-worker";
  server?:{port?:number;native?:NativeServerOptions};
  onConstructed?:(application:Application)=>undefined;${layers.extras.metrics ? '\n  runtimeMetrics?:Omit<MetricsRuntimeOptions,"failedJobs"|"outbox"> & {failedJobs?:Omit<NonNullable<MetricsRuntimeOptions["failedJobs"]>,"observeReadOnly">;outbox?:Omit<NonNullable<MetricsRuntimeOptions["outbox"]>,"observeReadOnly">};' : ""}
}
export interface BootstrappedApp {
  application:Application;
  auditExport:()=>Promise<number>;
  invoke:PersistenceInvocation;
  readonly outbox:Readonly<Pick<SqlOutbox,"publish">>;
  context:InitializedAppContext;
  routes:AppRouteMap;
  config:ReturnType<typeof loadConfig>;
  queue:import("@getstrata/core/queue").Queue;
  queueServices:import("@getstrata/core/queue/createAppQueue").QueueServices;
  registry:JobRegistry;
  server?:Server<unknown>;
  worker?:ReturnType<typeof createQueueWorkerTransport>;
  outboxWorker?:ReturnType<typeof createOutboxWorkerTransport>;
}
export function bootstrapApp(options:BootstrapOptions & {mode:"outbox-worker"}):Promise<BootstrappedApp & {outboxWorker:ReturnType<typeof createOutboxWorkerTransport>}>;
export function bootstrapApp(options?:BootstrapOptions):Promise<BootstrappedApp>;
export async function bootstrapApp(options:BootstrapOptions={}):Promise<BootstrappedApp> {
  const env=Object.freeze({...process.env});
  const production=isProductionEnv(env);
  const runMigrate=options.migrate??!production;
  if(production)assertProductionSecrets(env);
  ${plan.decisions.ensureDatabase ? "await ensureAppDatabase({provision:!production&&runMigrate});" : ""}
  // Schema commands finish and close their own separate resources before runtime starts.
  if(runMigrate)await migrate();
  const config=loadConfig(env);
  const dbOptions=databaseOptions(env);
  const modules=await ensureModulesLoaded({modulesDir:join(import.meta.dir,"../modules")});
  const listenerDeclarations=await discoverListeners({directory:join(import.meta.dir,"../listeners")});
  const cacheEffects=createModelCacheInvalidationEffects(repositoryDefinitions,modules,{cache:STARTER_CACHE_TOKEN,queue:STARTER_QUEUE_TOKEN});
  const catalog=[cacheEffects,...listenerDeclarations];
  const secret=env.SESSION_SECRET?.trim()??"";
  const abilities=abilityCatalog();
  const auth=createStarterAuthServices({environment:env,production,allowDevHeaders:!production&&env.AUTH_DEV_HEADERS==="true",jwtSecret:env.JWT_SECRET?.trim()||secret,sessionSecret:secret,
    signatureSecret:env.SIGNED_URL_SECRET?.trim()||secret||env.OAUTH_STATE_SECRET?.trim()||"",
    readSession:()=>null,
    abilities,roleAbilities:role=>[...(role==="admin"?abilities.admin:abilities.member)],
  });
  let invoke:PersistenceInvocation|undefined;
  let auditExport:(()=>Promise<number>)|undefined;
  const run:PersistenceInvocation=(envelope,work)=>{if(!invoke)throw new Error("Application owner has not been constructed.");return invoke(envelope,work);};
  let readyQueueServices:QueueServices|undefined;
  let readyRegistry:JobRegistry|undefined;
  const selectedRegistry=()=>{if(!readyRegistry)throw new Error("Job registry is not assembled.");return readyRegistry;};
  const selectedQueueServices=()=>{if(!readyQueueServices)throw new Error("Queue services are not assembled.");return readyQueueServices;};
  const queueServices:QueueServices={
    recordFailure:(...args)=>selectedQueueServices().recordFailure(...args),
    listRecent:(...args)=>selectedQueueServices().listRecent(...args),
    retry:(...args)=>selectedQueueServices().retry(...args),
    delete:(...args)=>selectedQueueServices().delete(...args),
    flush:()=>selectedQueueServices().flush(),
    runAttempt:(...args)=>selectedQueueServices().runAttempt(...args),
  };
  const outbox=createSqlOutboxBindings({invoke:run,connection:"main",tenancy:${JSON.stringify(layers.tenancy)},listeners:durableListeners});
  let publisher:BootstrappedApp["outbox"]|undefined;
  const mode=options.mode??"command";
  if(mode==="worker"&&!env.REDIS_URL)throw new Error("queue:work requires REDIS_URL.");
  const worker=mode==="worker"?createQueueWorkerTransport({redisUrl:env.REDIS_URL!,queueServices,registry:selectedRegistry}):undefined;
  const outboxWorker=mode==="outbox-worker"?createOutboxWorkerTransport(outbox.token):undefined;
  let server:Server<unknown>|undefined;
  let routes:AppRouteMap|undefined;
  let kernel:ReturnType<typeof createHttpKernel>|undefined;${layers.extras.metrics ? "\n  let metrics:MetricsRuntime|undefined;" : ""}
  const assembly:ServiceProvider={name:"starter.routes",async boot({dependencies,onCleanup}){
    assertAppDependenciesComplete(dependencies);
    kernel=createHttpKernel(dependencies);
    ${layers.extras.metrics ? 'const {failedJobs,outbox,...runtime}=options.runtimeMetrics??{};metrics=createMetricsRuntime({...runtime,...(failedJobs?{failedJobs:{...failedJobs,observeReadOnly:createOwnedReadOnlyObservation(handle.application,"main",dbOptions)}}:{}),...(outbox?{outbox:{...outbox,observeReadOnly:createOwnedReadOnlyObservation(handle.application,"main",dbOptions,{postgresPolicy:"bypass"})}}:{})});onCleanup(()=>metrics!.close(),"drain");' : "void onCleanup;"}
    routes=mergeSpaRoutes(dependencies,composeRouteMaps(
      Object.fromEntries(Object.entries(createHealthRoutes(dependencies,{pingOnHealth:true,healthFormat:"text",schemaCheck:()=>dependencies.invoke({kind:"request",actor:{kind:"system",policy:"http.schema-health"}},async({database})=>{try{await database.model(Note).query().limit(1).select("id").get();return true;}catch{return false;}})})).map(([path,handler])=>[path,kernel!.wrapPublicDocument(handler)])),
      buildRoutes(dependencies),${layers.extras.metrics ? "\n      Object.fromEntries(Object.entries(createMetricsRoutes({...metrics?.options,authorization:{token:env.METRICS_TOKEN,production}})).map(([path,handler])=>[path,kernel!.wrapPublicDocument(handler)]))," : ""}
    ),{distDirectory:join(import.meta.dir,"../../frontend/dist"),wrap:handler=>kernel!.wrapPublicDocument(handler)});
  }};
  const handle=createApplicationContext([],{
    connection:"main",
    http:{metadata:auth.metadata,features:{emailVerificationRequired:env.FEATURE_EMAIL_VERIFICATION==="true",viewsEnabled:["server-htmx","hybrid"].includes(env.FRONTEND_MODE??${JSON.stringify(layers.frontend)}),publicReadsEnabled:env.FEATURE_PUBLIC_READS==="true",etagEnabled:env.FEATURE_ETAG!=="false"},csrf:{token:csrfTokenOptionsFromEnvironment(env),allowDevelopmentHeaders:!production&&env.AUTH_DEV_HEADERS==="true",samlAcsUrl:env.SAML_ACS_URL??""},tenancy:${JSON.stringify(layers.tenancy)},production,allowTenantDevHeaders:!production&&env.TENANT_DEV_HEADERS==="true",signatureSecret:auth.config.signatureSecret,passwordConfirmation:auth.config.passwordConfirmation,
      ...(production?{publicTenancy:{resolveTenantId:async(host:string)=>host===new URL(config.appUrl).hostname?1:null}}:{}),${layers.extras.scim ? "\n      scim:createScimAuthenticator({resolveToken:token=>resolveScimTenantFromToken(token,env),resolveTenant})," : ""}
    },
    onConstructed:owner=>{invoke=owner.invoke;options.onConstructed?.(owner.application);return undefined;},
    providersFromScope:scope=>{readyRegistry=scope.resolve(QUEUE_JOB_REGISTRY_TOKEN);auditExport=scope.resolve(STARTER_AUDIT_EXPORT_TOKEN);readyQueueServices=scope.resolve(STARTER_QUEUE_SERVICES_TOKEN);const coordinator=scope.resolve(outbox.token);const publish=coordinator.publish;publisher=Object.freeze({publish:(...args:Parameters<SqlOutbox["publish"]>)=>publish.call(coordinator,...args)});return [...createStarterProviders(env,auth,scope.resolve(STARTER_CACHE_TOKEN),scope.resolve(STARTER_QUEUE_TOKEN),scope.resolve(STARTER_QUEUE_SERVICES_TOKEN),scope.resolve(APPLICATION_EVENT_BUS_TOKEN),scope.resolve(STARTER_BILLING_OPTIONS_TOKEN),scope.resolve(STARTER_STORAGE_TOKEN),selectedRegistry()),${workTracker ? '{name:"starter.workTracker",register({container}){container.set(WORK_TRACKER_OUTBOX,publisher!);}},' : ""}...modules.flatMap(module=>module.providers??[]),assembly];},
    definition:{config:{application:{url:config.appUrl,production}},services:[
      ...(options.services??[]),...outbox.services,...createStarterServices(env,run),...createDatabaseReadinessBindings("main",env),...catalog.flatMap(declaration=>declaration.services),
      ...createDatabaseBindings({default:"main",connections:{main:dbOptions},preparation:[outbox.token],repositories:[...repositoryDefinitions,failedJobRepository,...(options.persistence?.repositories??[])],models:[...modelDefinitions,...(options.persistence?.models??[])],repositoryEffects:[...catalog.flatMap(declaration=>declaration.repositoryEffects),...(options.persistence?.repositoryEffects??[])]}),
    ],providers:[],transports:[...(options.transports??[]),...(worker?[worker.transport]:[]),...(outboxWorker?[outboxWorker.transport]:[]),...(mode==="http"?[{name:"starter.http",async setup(scope:import("@getstrata/core/contracts/application").ProviderScope){
      if(!routes||!kernel)throw new Error("Route assembly did not finish before transport setup.");
      server=await scope.acquire(webServerResource({port:options.server?.port??config.port,native:options.server?.native??(config.hostname?{hostname:config.hostname}:undefined),routes,publicDir:join(import.meta.dir,"../../public"),enter:(request,handler)=>kernel!.run(request,handler)}));
    }}]:[]) ]},
  });
  const context=await handle.start();
  try {
    if(!routes)throw new Error("Routes were not assembled.");
    if(!publisher)throw new Error("Outbox publisher was not assembled.");
    return {application:handle.application,auditExport:auditExport!,invoke:handle.invoke,outbox:publisher,context,routes,config,queue:context.container.resolve(CORE_QUEUE_TOKEN),queueServices:selectedQueueServices(),registry:selectedRegistry(),...(server?{server}:{}),...(worker?{worker}:{}),...(outboxWorker?{outboxWorker}:{})};
  }catch(error){await handle.application.stop({reason:"STARTUP_FAILED"});throw error;}
}
export function createApp(options:BootstrapOptions={}) {return bootstrapApp({migrate:false,...options});}
/** HTTP acquisition is declared before startup, never added to an already ready application. */
export function createAppServer(options:Omit<BootstrapOptions,"mode">={}) {return bootstrapApp({...options,mode:"http"});}
`;
}

function renderRoutesTs(): string {
  return `import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import { composeRouteMaps } from "@getstrata/bootstrap/routePlan";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";

export function buildRoutes(dependencies: AppDependencies): AppRouteMap {
  const api = buildModuleRoutes(dependencies);
  return composeRouteMaps(
    ...(isViewsEnabled() ? [buildWebModuleRoutes(dependencies)] : []),
    api,
  );
}
`;
}

function renderOutboxRegistryTs(plan: StarterFeaturePlan): string {
  const workTracker = plan.decisions.workTracker;
  return `import type { DurableListener } from "@getstrata/core/events/outbox";
${workTracker ? 'import { workTrackerListener } from "../domain/workTracker.ts";\n' : ""}
/** Add listeners before publishing. An empty registry can run, and publish rejects unknown events. */
const listeners: readonly DurableListener[] = [${workTracker ? "workTrackerListener" : ""}];

export { listeners };
`;
}

function renderScheduleTs(): string {
  return `import { createAppSchedule } from "@getstrata/bootstrap/schedule";
import type { BootstrappedApp } from "./createApp.ts";
export function createSchedule(app:Pick<BootstrappedApp,"invoke"|"auditExport">,environment:Readonly<Record<string,string|undefined>>) {
  return createAppSchedule({invoke:app.invoke,auditExport:app.auditExport,environment});
}
`;
}

function renderViewProvider(plan: StarterFeaturePlan): string {
  const layers = plan.layers;
  return `import { join } from "node:path";
import { createViewProvider } from "@getstrata/bootstrap/providers/view";
import { establishedAuthReader } from "@getstrata/core/auth/authReader";

export function createStarterViewProvider(env:Readonly<Record<string,string|undefined>>) {
  ${layers.extras.oidc ? 'const oidcLogin = env.FEATURE_OAUTH === "true" && Boolean(env.OIDC_CLIENT_ID?.trim() && env.OIDC_CLIENT_SECRET?.trim());' : "void env;"}
  return createViewProvider({${plan.decisions.mfaViews ? "\n  enabled: true," : ""}
  directory: join(import.meta.dir, "../../../views"),
  data: {
    userKey: "currentUser",
    loadUser: async (_container, request) => {
      const user = await establishedAuthReader.user(request);
      return user ? { id: Number(user.id), name: user.name ?? "", email: user.email ?? "", role: user.role ?? "member" } : null;
    },${
      layers.extras.oidc
        ? `
    extra: () => ({
      oidcLogin,
    }),`
        : ""
    }
  },
});
}
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
