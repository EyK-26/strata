/**
 * @getstrata/bootstrap — application shell for Strata sibling apps.
 */

export {
  resolveApplicationAuth,
  resolveApplicationCache,
  resolveApplicationConfig,
  resolveApplicationDependencies,
  resolveApplicationLogger,
  resolveApplicationPolicyGate,
  resolveApplicationQueue,
  setActiveApplicationContext,
} from "@getstrata/core";
export { scheduleRunCommand } from "../cli/commands/scheduleRun.ts";
export type { ScheduledTask } from "../core/scheduler/schedule.ts";
export { appSchedule, runDueScheduledTasks, Schedule } from "../core/scheduler/schedule.ts";
export {
  APP_PORT_CONFIG_KEY,
  CORE_AUTH_TOKEN,
  CORE_CACHE_TOKEN,
  CORE_CONFIG_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
  CORE_TOKEN_SERVICE_TOKEN,
  DATABASE_URL_CONFIG_KEY,
  DEFAULT_APP_PORT,
  REDIS_URL_CONFIG_KEY,
} from "./config.ts";
export { collectProviders, createAppContext, runProviderPhase } from "./context.ts";
export type {
  AppContext,
  AppDependencies,
  AppModule,
  AppRouteMap,
  CachedJson,
  ConfigStore,
  ModuleRouteContext,
  MutableAppDependencies,
  ProviderContext,
  ServiceFactory,
  ServiceProvider,
} from "./contracts.ts";
export {
  assertAppDependenciesComplete,
  getRequiredDependency,
  resolveService,
  ServiceContainer,
} from "./contracts.ts";
export { createWebRoutes, mergeWebRoutes } from "./createWebRoutes.ts";
export {
  type RouteModelAuthorization,
  securedBindRouteModel,
  securedBindRouteModelByKey,
} from "./http/securedRouteModelBinding.ts";
export { createHttpKernel, type HttpKernel, type MiddlewareGroupName } from "./httpKernel.ts";
export { resolveMembershipService } from "./membershipService.ts";
export { prefixRouteMap } from "./prefixRouteMap.ts";
export { coreProviders } from "./providers/index.ts";
export { registerDefaultJobs } from "./queue/defaultJobs.ts";

export {
  CookieSessionStore,
  createCsrfProtection,
  createRouteKernel,
  createWebServer,
  type ParsedForm,
  parseFormBody,
  routeParams,
  type SessionUser,
  slugify,
  toRouteRequest,
  type WebServerOptions,
  wrapSecuredRouteModelByKey,
  wrapWebLogin,
  wrapWebRegister,
} from "./web/index.ts";
