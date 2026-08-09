/**
 * Stable framework surface for application modules and future package extraction.
 * Import from `@getstrata/core` (workspace) or `src/framework/public-api`.
 */

export type {
  AdminColumn,
  AdminColumnType,
  AdminResource,
  AdminResourceDefinition,
  AdminResourceHandlers,
} from "../core/admin/index.ts";
export {
  AdminResourceRegistry,
  formatAdminValue,
} from "../core/admin/index.ts";
export type { AbilityChecker } from "../core/auth/abilityChecker.ts";
export { isGlobalAdmin, resolveUserId } from "../core/auth/accessControl.ts";
export type { AuthUser } from "../core/auth/authContext.ts";
export { authContext, currentAuthUser, runWithAuthUser } from "../core/auth/authContext.ts";
export { BasicAuthGuard } from "../core/auth/basicAuthGuard.ts";
export type { AuthGuard } from "../core/auth/guard.ts";
export {
  ApiTokenGuard,
  AuthManager,
  CompositeGuard,
  DatabaseTokenGuard,
  GuestGuard,
} from "../core/auth/guard.ts";
export type { JwtPayload } from "../core/auth/jwt.ts";
export { jwtTtlSeconds, signJwt, verifyJwt } from "../core/auth/jwt.ts";
export { JwtGuard } from "../core/auth/jwtGuard.ts";
export {
  configureMembershipLookup,
  currentOrganizationIds,
  currentOrgRole,
  hasMinimumOrgRole,
  hasOrgMembership,
  resolveMembershipLookup,
  runWithMembershipContext,
} from "../core/auth/membershipContext.ts";
export { createMembershipMiddleware } from "../core/auth/membershipMiddleware.ts";
export {
  appendOrganizationScope,
  appendProjectScope,
  assertOrganizationReadable,
  assertResourceInCurrentTenant,
  emptyPaginateResult,
  resolveOrganizationScope,
  scopedOrganizationIds,
} from "../core/auth/membershipScope.ts";
export {
  default as MembershipService,
  resolveMembershipService,
} from "../core/auth/membershipService.ts";
export { Policy, PolicyGate } from "../core/auth/policy.ts";
export { createScimAuthMiddleware } from "../core/auth/scimAuthMiddleware.ts";
export { createTokenAbilityChecker } from "../core/auth/tokenAbilityChecker.ts";
export {
  type CacheDriver,
  type CreateCacheStoreOptions,
  createCacheStore,
} from "../core/cache/createCacheStore.ts";
export { default as CacheRepository } from "../core/cache/repository.ts";
export { CACHE_TAGS } from "../core/cache/tags.ts";
export { ConfigStore, ServiceContainer } from "../core/contracts/container.ts";
export type { ServiceProvider } from "../core/contracts/di.ts";
export { resolveService } from "../core/contracts/di.ts";
export type { DatabaseConnection } from "../core/database/baseRepository.ts";
export { default as BaseRepository } from "../core/database/baseRepository.ts";
export {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "../core/database/bindConnection.ts";
export { bindBunSql, createBunSqlPool } from "../core/database/bunSql.ts";
export { createDatabaseConnection } from "../core/database/connection.ts";
export {
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "../core/database/connectionContext.ts";
export {
  getDefaultDatabasePool,
  getDefaultDatabaseQuery,
  registerDefaultDatabasePool,
} from "../core/database/defaultConnection.ts";
export type { SqlDialect } from "../core/database/dialect.ts";
export {
  currentSqlDialect,
  dialectFor,
  resetSqlDialect,
  runWithSqlDialect,
  sqlTimestamp,
  useSqlDialect,
} from "../core/database/dialect.ts";
export { Factory } from "../core/database/factory.ts";
export { foreignKeyFromTable, pivotTableName, singularize } from "../core/database/inflection.ts";
export { withMigrationLock } from "../core/database/migrations/advisoryLock.ts";
export {
  freshDatabase,
  getMigrationStatus,
  loadMigrationsFromDirectory,
  migrateDatabase,
  rollbackDatabase,
} from "../core/database/migrations/runner.ts";
export type {
  Migration,
  MigrationDatabase,
  MigrationStatus,
} from "../core/database/migrations/types.ts";
export type { CastType, GlobalScopeFn, ModelConstructor } from "../core/database/model.ts";
export {
  applyCasts,
  BelongsToManyRelationQuery,
  BelongsToRelationQuery,
  dehydrateValue,
  filterMassAssignable,
  HasManyRelationQuery,
  HasOneRelationQuery,
  hydrateValue,
  Model,
  ModelQuery,
  MorphManyRelationQuery,
  MorphOneRelationQuery,
  MorphToRelationQuery,
  registerModelClass,
  registerModelRepository,
} from "../core/database/model.ts";
export type {
  MysqlConnection,
  MysqlExecutable,
  MysqlPool,
} from "../core/database/mysqlConnection.ts";
export {
  createMysqlConnection,
  createMysqlConnectionFromPool,
  createMysqlPool,
} from "../core/database/mysqlConnection.ts";
export {
  getNamedConnection,
  hasNamedConnection,
  registerNamedConnection,
  resetNamedConnections,
  runOnNamedConnection,
  unregisterNamedConnection,
} from "../core/database/namedConnections.ts";
export { createDatabaseQueryProxy } from "../core/database/queryProxy.ts";
export type {
  BelongsToManyRelation,
  BelongsToRelation,
  HasManyRelation,
  HasOneRelation,
  MorphManyRelation,
  MorphOneRelation,
  MorphToRelation,
} from "../core/database/relationships.ts";
export {
  belongsTo,
  belongsToMany,
  hasMany,
  hasOne,
  indexBelongsToManyRelation,
  indexBelongsToRelation,
  indexHasManyRelation,
  indexHasOneRelation,
  indexMorphManyRelation,
  indexMorphOneRelation,
  indexMorphToRelation,
  morphMany,
  morphOne,
  morphTo,
} from "../core/database/relationships.ts";
export {
  repositoryConnection,
  resolveRepositoryConnection,
} from "../core/database/repositoryConnection.ts";
export { RepositoryQuery } from "../core/database/repositoryQuery.ts";
export type {
  BlueprintAction,
  BlueprintCallback,
  ColumnKind,
  DatabaseDriver,
  ForeignKeyOptions,
  Grammar,
  IndexDefinition,
  IndexKind,
  ResolveDatabaseDriverOptions,
  SchemaBuilder,
} from "../core/database/schema/index.ts";
export {
  Blueprint,
  ColumnDefinition,
  compileBlueprint,
  createSchemaBuilder,
  ForeignIdColumnDefinition,
  grammarForDriver,
  inferReferencedTable,
  MySqlGrammar,
  PostgresGrammar,
  resolveDatabaseDriver,
  Schema,
  SqliteGrammar,
  UnsupportedSchemaFeatureError,
} from "../core/database/schema/index.ts";
export {
  loadSeedersFromDirectory,
  runSeedersFromDirectory,
} from "../core/database/seeders/runner.ts";
export type { Seeder, SeederDatabase } from "../core/database/seeders/types.ts";
export { createSqliteConnection } from "../core/database/sqliteConnection.ts";
export { defineTable } from "../core/database/table.ts";
export { runInTransaction } from "../core/database/transaction.ts";
export type {
  QueryJoin,
  QueryJoinOn,
  QueryOptions,
  QueryOrder,
  QuerySelectItem,
  QueryWhere,
} from "../core/database/types.ts";
export type { WhereNode } from "../core/database/whereBuilder.ts";
export { WhereBuilder } from "../core/database/whereBuilder.ts";
export {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  InternalServerError,
  isHttpErrorLike,
  NotFoundError,
  PayloadTooLargeError,
  PreconditionFailedError,
  toHttpError,
  UnauthorizedError,
  UnprocessableEntityError,
  ValidationError,
} from "../core/errors/http.ts";
export type { EventListener } from "../core/events/eventBus.ts";
export { EventBus, eventBus } from "../core/events/eventBus.ts";
export { modelEventName } from "../core/events/index.ts";
export {
  auth,
  cache,
  config,
  events,
  log,
  mail,
  policyGate,
  queue,
  storage,
} from "../core/facades/index.ts";
export { createBodySizeLimitMiddleware } from "../core/http/bodySizeLimitMiddleware.ts";
export { readClientIp, trustForwardedFor } from "../core/http/clientIp.ts";
export { conditionalJsonResponse } from "../core/http/conditionalResponse.ts";
export type {
  ContentSecurityPolicyDirectives,
  ContentSecurityPolicyOptions,
} from "../core/http/contentSecurityPolicy.ts";
export {
  configureContentSecurityPolicy,
  generateCspNonce,
  resolveContentSecurityPolicy,
  resolveHtmlContentSecurityPolicy,
  serverHtmxContentSecurityPolicy,
  spaContentSecurityPolicy,
  strictApiContentSecurityPolicy,
} from "../core/http/contentSecurityPolicy.ts";
export { readBunRequestCookie, readRequestCookie } from "../core/http/cookies.ts";
export { createCorsMiddleware } from "../core/http/corsMiddleware.ts";
export { createCsrfMiddleware } from "../core/http/csrfMiddleware.ts";
export { createCsrfProtection } from "../core/http/csrfProtection.ts";
export {
  createCsrfTokenCookie,
  readSubmittedCsrfToken,
  readSubmittedCsrfTokenFromBody,
  resolveCsrfToken,
  resolveCsrfTokenForRequest,
  verifyCsrfToken,
} from "../core/http/csrfToken.ts";
export {
  applyConditionalGet,
  assertIfMatch,
  type EtagVersioned,
  etagFromResource,
  isEtagEnabled,
} from "../core/http/etag.ts";
export { createFlashMiddleware } from "../core/http/flashMiddleware.ts";
export { FormRequest } from "../core/http/formRequest.ts";
export {
  applyMiddlewareToRoutes,
  bindRouteModel,
  buildRequestCacheKey,
  composeMiddleware,
  createAuthMiddleware,
  createAuthorizeMiddleware,
  createRequireAuthMiddleware,
  paginatedResponse,
  parsePaginationQuery,
  parsePositiveIntParam,
  requestIdMiddleware,
  securedBindRouteModel,
  securedBindRouteModelByKey,
  withMiddleware,
  wrapRouteHandler,
} from "../core/http/index.ts";
export { createLoginThrottleMiddleware } from "../core/http/loginThrottleMiddleware.ts";
export {
  createMemoryThrottleMiddleware,
  resetMemoryThrottleForTests,
} from "../core/http/memoryThrottleMiddleware.ts";
export { createMetricsMiddleware, normalizeMetricPath } from "../core/http/metricsMiddleware.ts";
export type { Middleware, RouteHandler } from "../core/http/middleware.ts";
export { type ParsedUpload, parseMultipartUpload } from "../core/http/parseMultipartUpload.ts";
export type { RequestMeta } from "../core/http/requestMetaContext.ts";
export { currentRequestMeta, runWithRequestMeta } from "../core/http/requestMetaContext.ts";
export { createRequireAbilityMiddleware } from "../core/http/requireAbilityMiddleware.ts";
export { createRequireGlobalAdminMiddleware } from "../core/http/requireGlobalAdminMiddleware.ts";
export { createRequireWebAuthMiddleware } from "../core/http/requireWebAuthMiddleware.ts";
export {
  JsonResource,
  ResourceCollection,
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
  whenLoaded,
} from "../core/http/resources.ts";
export {
  createdResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
} from "../core/http/response.ts";
export type { RouteRequest } from "../core/http/route.ts";
export {
  loginRedirectLocation,
  safeInternalRedirectPath,
  sanitizeInternalPath,
} from "../core/http/safeInternalPath.ts";
export { createScimThrottleMiddleware } from "../core/http/scimThrottleMiddleware.ts";
export { createSecurityHeadersMiddleware } from "../core/http/securityHeadersMiddleware.ts";
export {
  absoluteTemporarySignedUrl,
  assertValidSignature,
  createValidateSignatureMiddleware,
  hasValidSignature,
  signedUrl,
  temporarySignedUrl,
} from "../core/http/signedUrl.ts";
export { createThrottleMiddleware } from "../core/http/throttleMiddleware.ts";
export { WebFormRequest } from "../core/http/webFormRequest.ts";
export {
  installGracefulShutdownSignals,
  registerShutdownHandler,
  runGracefulShutdown,
} from "../core/lifecycle/gracefulShutdown.ts";
export { createRequestLoggingMiddleware } from "../core/logging/requestLoggingMiddleware.ts";
export type { MailDriver, MailMessage } from "../core/mail/mailer.ts";
export {
  buildSmtpPayload,
  LogMailDriver,
  Mailer,
  mailer,
} from "../core/mail/mailer.ts";
export type { MarkdownMailLayoutOptions, RenderedMarkdownMail } from "../core/mail/markdownMail.ts";
export {
  markdownToHtml,
  renderMarkdownMail,
  stripMarkdown,
  wrapMarkdownMailLayout,
} from "../core/mail/markdownMail.ts";
export type { MarkdownMailableInput } from "../core/mail/markdownMailable.ts";
export { buildMarkdownMailMessage, sendMarkdownMail } from "../core/mail/markdownMailable.ts";
export { sanitizeMailHtml } from "../core/mail/sanitizeMailHtml.ts";
export type { MetricLabels } from "../core/metrics/prometheus.ts";
export { PrometheusRegistry, prometheusRegistry } from "../core/metrics/prometheus.ts";
export type {
  DatabaseNotificationPayload,
  DatabaseNotificationStore,
  MailNotificationMessage,
  Notifiable,
  NotificationChannelName,
} from "../core/notifications/index.ts";
export {
  createNotificationDispatcher,
  Notification,
  NotificationDispatcher,
} from "../core/notifications/index.ts";
export type {
  CursorPaginatedResult,
  PaginatedResult,
  PaginationMeta,
} from "../core/pagination/index.ts";
export type { Queue, QueuePriority } from "../core/queue/index.ts";
export { AsyncQueue, createQueue, Job, SyncQueue } from "../core/queue/index.ts";
export {
  createFailedJobService,
  createProductionQueue,
  createQueueWorker,
  createTrackedJob,
  FailedJobRepository,
  FailedJobService,
  jobRegistry,
  QueueWorker,
  RedisQueue,
  ResilientQueue,
  runQueueJob,
} from "../core/queue/publicQueue.ts";
export type { QueueMetricsSnapshot } from "../core/queue/queueMetrics.ts";
export { collectQueueMetrics } from "../core/queue/queueMetrics.ts";
export { envFlagEnabled, isProductionEnv } from "../core/runtime/appEnv.ts";
export {
  apiPrefix,
  appCookieName,
  appDevSecret,
  appDisplayName,
  appEnv,
  appKeyPrefix,
  appUrl,
  appUserAgent,
  namespacedRedisKey,
  otelServiceName,
  requireConfiguredSecret,
  sdkClientClassName,
  siemEventType,
  smtpEhloHost,
  webhookSignatureHeader,
} from "../core/runtime/appKeyPrefix.ts";
export {
  resolveApplicationAuth,
  resolveApplicationCache,
  resolveApplicationConfig,
  resolveApplicationDependencies,
  resolveApplicationEventBus,
  resolveApplicationLogger,
  resolveApplicationPolicyGate,
  resolveApplicationQueue,
  setActiveApplicationContext,
} from "../core/runtime/applicationRegistry.ts";
export type { ScheduledTask } from "../core/scheduler/schedule.ts";
export { appSchedule, runDueScheduledTasks, Schedule } from "../core/scheduler/schedule.ts";
export { guestCanViewResource, isPublicReadsEnabled } from "../core/security/publicReads.ts";
export type { SecurityEventDetails } from "../core/security/securityEvents.ts";
export { logSecurityEvent } from "../core/security/securityEvents.ts";
export type { StorageDriver } from "../core/storage/storage.ts";
export {
  createStorageDriver,
  LocalStorageDriver,
  resetDefaultStorage,
  StorageManager,
} from "../core/storage/storage.ts";
export type { TenancyDriver } from "../core/tenant/tenancyConfig.ts";
export {
  isRlsTenancy,
  isTenancyEnabled,
  readTenancyDriver,
} from "../core/tenant/tenancyConfig.ts";
export type { TenantContext } from "../core/tenant/tenantContext.ts";
export {
  currentTenant,
  currentTenantId,
  rateLimitMultiplierForPlan,
  runWithTenant,
} from "../core/tenant/tenantContext.ts";
export {
  isInsideTenantDatabaseScope,
  runWithTenantDatabase,
} from "../core/tenant/tenantDatabaseScope.ts";
export {
  auditChecksum,
  createTenantMiddleware,
  DEFAULT_TENANT,
  resolveUserTenantId,
} from "../core/tenant/tenantMiddleware.ts";
export type { TraceContext } from "../core/tracing/traceContext.ts";
export { currentTraceId, runWithTraceContext } from "../core/tracing/traceContext.ts";
export { createTracingMiddleware } from "../core/tracing/tracingMiddleware.ts";
export type { ValidationRule, ValidationSchema } from "../core/validation/rules.ts";
export {
  emailRule,
  maxLength,
  minLength,
  required,
  stringRule,
  validateObject,
} from "../core/validation/rules.ts";
export {
  configureWebErrorView,
  configureWebLayoutData,
  DEFAULT_VIEWS_DIRECTORY,
  EtaViewEngine,
  errorTemplateName,
  htmlErrorResponse,
  htmlResponse,
  isHtmxRequest,
  notFoundHtmlResponse,
  redirectResponse,
  renderKernelErrorChrome,
  resolveWebLayoutData,
  rssResponse,
  textResponse,
  xmlResponse,
} from "../core/view/index.ts";
export type { ViewEngine } from "../core/view/viewEngine.ts";
export type {
  WebLayoutAuthUser,
  WebLayoutData,
  WebLayoutDataOptions,
  WebLayoutUserKey,
} from "../core/view/webLayoutData.ts";
