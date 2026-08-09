/**
 * Stable framework surface for application modules and future package extraction.
 * Import from `@getstrata/core` (workspace) or `src/framework/public-api`.
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
} from "../bootstrap/applicationRegistry.ts";
export type { ServiceProvider } from "../bootstrap/contracts.ts";
export {
  ConfigStore,
  resolveService,
  ServiceContainer,
} from "../bootstrap/contracts.ts";
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
export type { AuthUser } from "../core/auth/authContext.ts";
export { currentAuthUser, runWithAuthUser } from "../core/auth/authContext.ts";
export { Policy, PolicyGate } from "../core/auth/policy.ts";
export { default as CacheRepository } from "../core/cache/repository.ts";
export { CACHE_TAGS } from "../core/cache/tags.ts";
export type { DatabaseConnection } from "../core/database/baseRepository.ts";
export { default as BaseRepository } from "../core/database/baseRepository.ts";
export { bindDatabaseConnection } from "../core/database/bindConnection.ts";
export { createDatabaseConnection } from "../core/database/connection.ts";
export {
  getActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "../core/database/connectionContext.ts";
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
  dehydrateValue,
  filterMassAssignable,
  hydrateValue,
  Model,
  registerModelRepository,
} from "../core/database/model.ts";
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
  NotFoundError,
  PreconditionFailedError,
  UnauthorizedError,
  UnprocessableEntityError,
  ValidationError,
} from "../core/errors/http.ts";
export { EventBus } from "../core/events/eventBus.ts";
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
export { readBunRequestCookie, readRequestCookie } from "../core/http/cookies.ts";
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
  assertIfMatch,
  etagFromResource,
  isEtagEnabled,
} from "../core/http/etag.ts";
export { FormRequest } from "../core/http/formRequest.ts";
export {
  applyMiddlewareToRoutes,
  composeMiddleware,
  createAuthMiddleware,
  createAuthorizeMiddleware,
  createdResponse,
  createRequireAuthMiddleware,
  jsonResponse,
  noContentResponse,
  paginatedResponse,
  parsePaginationQuery,
  securedBindRouteModel,
  securedBindRouteModelByKey,
  withErrorHandling,
  withMiddleware,
} from "../core/http/index.ts";
export { createLoginThrottleMiddleware } from "../core/http/loginThrottleMiddleware.ts";
export { createMemoryThrottleMiddleware } from "../core/http/memoryThrottleMiddleware.ts";
export { createMetricsMiddleware, normalizeMetricPath } from "../core/http/metricsMiddleware.ts";
export type { Middleware, RouteHandler } from "../core/http/middleware.ts";
export { createRequireWebAuthMiddleware } from "../core/http/requireWebAuthMiddleware.ts";
export {
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
} from "../core/http/resources.ts";
export type { RouteRequest } from "../core/http/route.ts";
export { createSecurityHeadersMiddleware } from "../core/http/securityHeadersMiddleware.ts";
export { createThrottleMiddleware } from "../core/http/throttleMiddleware.ts";
export { WebFormRequest } from "../core/http/webFormRequest.ts";
export {
  installGracefulShutdownSignals,
  registerShutdownHandler,
  runGracefulShutdown,
} from "../core/lifecycle/gracefulShutdown.ts";
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
export type { ScheduledTask } from "../core/scheduler/schedule.ts";
export { appSchedule, runDueScheduledTasks, Schedule } from "../core/scheduler/schedule.ts";
export type { StorageDriver } from "../core/storage/storage.ts";
export { LocalStorageDriver, StorageManager } from "../core/storage/storage.ts";
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
  DEFAULT_VIEWS_DIRECTORY,
  EtaViewEngine,
  htmlResponse,
  isHtmxRequest,
  resolveWebLayoutData,
} from "../core/view/index.ts";
export type { ViewEngine } from "../core/view/viewEngine.ts";
export type { WebLayoutAuthUser, WebLayoutData } from "../core/view/webLayoutData.ts";
