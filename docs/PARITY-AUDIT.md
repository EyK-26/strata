# Laravel parity audit

Generated: 2026-08-15T21:31:12.867Z

## Score

| Metric | Value |
|--------|-------|
| **Core parity score** | **100%** |
| Core sections | 46 |
| Covered | 46 |
| Partial | 0 |
| Gaps | 0 |

Target: ≥99% core coverage across all documented Laravel sections.

## Core matrix

| Status | Laravel section | Strata API | Tests |
|--------|-----------------|------------|-------|
| ✅ covered | [Service Container](https://laravel.com/docs/container) | ServiceContainer, resolveService, @getstrata/bootstrap:ServiceContainer… | `unit/providers.test.ts` |
| ✅ covered | [Service Providers](https://laravel.com/docs/providers) | @getstrata/bootstrap:ServiceProvider, @getstrata/bootstrap:runProviderPhase, @getstrata/bootstrap:collectProviders… | `unit/providers.test.ts` |
| ✅ covered | [Facades](https://laravel.com/docs/facades) | cache, queue, events… | `unit/events.test.ts` |
| ✅ covered | [Routing](https://laravel.com/docs/routing) | applyMiddlewareToRoutes, withMiddleware, composeMiddleware… | `unit/httpKernel.test.ts` |
| ✅ covered | [Middleware](https://laravel.com/docs/middleware) | createCsrfMiddleware, createSecurityHeadersMiddleware, createBodySizeLimitMiddleware… | `unit/csrf.test.ts` |
| ✅ covered | [CSRF Protection](https://laravel.com/docs/csrf) | createCsrfMiddleware, @getstrata/bootstrap:createCsrfProtection | `unit/csrf.test.ts` |
| ✅ covered | [Controllers](https://laravel.com/docs/controllers) | withErrorHandling, jsonResponse, RouteHandler | `integration/routes.integration.test.ts` |
| ✅ covered | [Form Requests](https://laravel.com/docs/validation#form-request-validation) | FormRequest, WebFormRequest, validateObject… | `unit/formRequest.test.ts` |
| ✅ covered | [Views](https://laravel.com/docs/views) | EtaViewEngine, htmlResponse, resolveWebLayoutData | `unit/etaViewEngine.test.ts` |
| ✅ covered | [Validation](https://laravel.com/docs/validation) | ValidationError, validateObject, minLength… | `unit/validationRules.test.ts` |
| ✅ covered | [Error Handling](https://laravel.com/docs/errors) | NotFoundError, ForbiddenError, UnauthorizedError… | `unit/databaseErrors.test.ts` |
| ✅ covered | [Database: Getting Started](https://laravel.com/docs/database) | bindDatabaseConnection, getActiveDatabaseConnection, runWithDatabaseConnection | `unit/databaseConnection.test.ts` |
| ✅ covered | [Query Builder](https://laravel.com/docs/queries) | RepositoryQuery, WhereBuilder, BaseRepository | `unit/database/queryBuilder.test.ts` |
| ✅ covered | [Pagination](https://laravel.com/docs/pagination) | paginatedResponse, parsePaginationQuery, toPaginatedResourceCollection | `unit/pagination.test.ts` |
| ✅ covered | [Migrations](https://laravel.com/docs/migrations) | migrateDatabase, rollbackDatabase, freshDatabase… | `unit/migrationRunner.test.ts` |
| ✅ covered | [Schema Builder](https://laravel.com/docs/migrations#tables) | Schema, Blueprint, defineTable… | `unit/database/schema/grammarSnapshots.test.ts` |
| ✅ covered | [Database Seeding](https://laravel.com/docs/seeding) | runSeedersFromDirectory, loadSeedersFromDirectory | `unit/frameworkPublicApi.test.ts` |
| ✅ covered | [Eloquent: Getting Started](https://laravel.com/docs/eloquent) | Model, registerModelRepository, filterMassAssignable… | `unit/database/model.test.ts` |
| ✅ covered | [Eloquent: Relationships](https://laravel.com/docs/eloquent-relationships) | hasMany, hasOne, belongsTo… | `unit/database/model.relationships.test.ts` |
| ✅ covered | [Eloquent: Soft Deleting](https://laravel.com/docs/eloquent#soft-deleting) | Model | `unit/database/model.softDelete.test.ts` |
| ✅ covered | [Eloquent: API Resources](https://laravel.com/docs/eloquent-resources) | toResourceCollection, serializeDate, toPaginatedResourceCollection | `unit/frameworkPublicApi.test.ts` |
| ✅ covered | [Eloquent: Factories](https://laravel.com/docs/eloquent-factories) | Exported via @getstrata/core/database/factory subpath | `unit/factory.test.ts` |
| ✅ covered | [Authorization](https://laravel.com/docs/authorization) | Policy, PolicyGate, createAuthorizeMiddleware | `unit/policy.test.ts` |
| ✅ covered | [Authentication](https://laravel.com/docs/authentication) | createAuthMiddleware, createRequireAuthMiddleware, currentAuthUser | `unit/authService.test.ts` |
| ✅ covered | [Route Model Binding](https://laravel.com/docs/routing#route-model-binding) | securedBindRouteModel, securedBindRouteModelByKey, @getstrata/bootstrap:securedBindRouteModel… | `unit/securedRouteModelBinding.test.ts` |
| ✅ covered | [Events](https://laravel.com/docs/events) | EventBus, events | `unit/events.test.ts` |
| ✅ covered | [Queues](https://laravel.com/docs/queues) | Job, RedisQueue, QueueWorker… | `unit/queue.test.ts` |
| ✅ covered | [Queues: Dealing With Failed Jobs](https://laravel.com/docs/queues#dealing-with-failed-jobs) | FailedJobService, FailedJobRepository, createFailedJobService | `unit/failedJobService.test.ts` |
| ✅ covered | [Task Scheduling](https://laravel.com/docs/scheduling) | Schedule, appSchedule, runDueScheduledTasks… | `unit/schedule.test.ts` |
| ✅ covered | [Cache](https://laravel.com/docs/cache) | CacheRepository, CACHE_TAGS, cacheTagsForModelWrite… | `unit/cacheRepository.test.ts` |
| ✅ covered | [Rate Limiting](https://laravel.com/docs/routing#rate-limiting) | createThrottleMiddleware, createMemoryThrottleMiddleware, createLoginThrottleMiddleware | `unit/throttleMiddleware.test.ts` |
| ✅ covered | [File Storage](https://laravel.com/docs/filesystem) | StorageManager, LocalStorageDriver, storage | `unit/storage.test.ts` |
| ✅ covered | [Mail](https://laravel.com/docs/mail) | Mailer, LogMailDriver, mailer… | `unit/mailer.test.ts` |
| ✅ covered | [Database: Transactions](https://laravel.com/docs/database#database-transactions) | runInTransaction | `unit/database.test.ts` |
| ✅ covered | [Deployment: Graceful Shutdown](https://laravel.com/docs/deployment) | installGracefulShutdownSignals, registerShutdownHandler, runGracefulShutdown | `unit/gracefulShutdown.test.ts` |
| ✅ covered | [Observability](https://laravel.com/docs/logging) | PrometheusRegistry, prometheusRegistry, createMetricsMiddleware | `unit/metrics.test.ts` |
| ✅ covered | [HTTP: Conditional Requests](https://laravel.com/docs/requests) | assertIfMatch, etagFromResource, isEtagEnabled | `unit/etag.test.ts` |
| ✅ covered | [Session](https://laravel.com/docs/session) | @getstrata/bootstrap:CookieSessionStore, @getstrata/bootstrap:createWebServer | `unit/sessionCookie.test.ts` |
| ✅ covered | [Query Builder: Chunks / Cursors](https://laravel.com/docs/queries#chunking-results) | BaseRepository | `unit/database/repositoryPhase3.test.ts` |
| ✅ covered | [Billing Webhooks](https://laravel.com/docs/billing) | verifyStripeWebhook via @getstrata/core/security/stripeWebhook subpath | `unit/stripeWebhook.test.ts` |
| ✅ covered | [Eloquent: Polymorphic Relations](https://laravel.com/docs/eloquent-relationships#polymorphic-relationships) | morphTo, morphMany, morphOne… | `unit/database/morphRelations.test.ts` |
| ✅ covered | [Notifications](https://laravel.com/docs/notifications) | Notification, NotificationDispatcher, createNotificationDispatcher | `unit/notifications.test.ts` |
| ✅ covered | [Mail: Markdown Templates](https://laravel.com/docs/mail#markdown-mailables) | renderMarkdownMail, buildMarkdownMailMessage, sendMarkdownMail… | `unit/markdownMail.test.ts` |
| ✅ covered | [Horizon (queue dashboard)](https://laravel.com/docs/horizon) | collectQueueMetrics, FailedJobService, FailedJobRepository… | `unit/adminServiceMetrics.test.ts` |
| ✅ covered | [Nova (admin panel)](https://laravel.com/docs/nova) | AdminResourceRegistry, formatAdminValue | `unit/adminRegistry.test.ts` |
| ✅ covered | [Artisan Console](https://laravel.com/docs/artisan) | @getstrata/bootstrap:scheduleRunCommand | `unit/bootstrapSchedule.test.ts` |
