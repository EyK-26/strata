# Laravel parity audit

Generated: 2026-09-04T16:25:50.200Z

API catalog score means each Laravel doc section has a Strata export and a test.
Design score means the call shape matches Laravel, routed to TypeScript/Bun.
Stand-in is not design-complete. See `docs/DESIGN-PARITY.md`.

## Score

| Metric | Value |
|--------|-------|
| **API catalog score** | **100%** |
| **Design parity score** | **91.5%** |
| Core sections | 47 |
| API covered | 47 |
| API partial | 0 |
| API gaps | 0 |
| Design laravel | 42 |
| Design partial | 2 |
| Design stand-in | 3 |

CI target: ≥99% API catalog score. Design score is the real Laravel-similarity goal.

## Core matrix

| Status | Design | Laravel section | Strata API | Tests |
|--------|--------|-----------------|------------|-------|
| ✅ covered | laravel | [Service Container](https://laravel.com/docs/container) | ServiceContainer, resolveService, @getstrata/bootstrap:ServiceContainer… | `unit/providers.test.ts` |
| ✅ covered | laravel | [Service Providers](https://laravel.com/docs/providers) | @getstrata/bootstrap:ServiceProvider, @getstrata/bootstrap:runProviderPhase, @getstrata/bootstrap:collectProviders… | `unit/providers.test.ts` |
| ✅ covered | laravel | [Facades](https://laravel.com/docs/facades) | cache, queue, events… | `unit/events.test.ts` |
| ✅ covered | laravel | [Routing](https://laravel.com/docs/routing) | applyMiddlewareToRoutes, withMiddleware, composeMiddleware… | `unit/httpKernel.test.ts` |
| ✅ covered | laravel | [Middleware](https://laravel.com/docs/middleware) | createCsrfMiddleware, createSecurityHeadersMiddleware, createBodySizeLimitMiddleware… | `unit/csrf.test.ts` |
| ✅ covered | laravel | [CSRF Protection](https://laravel.com/docs/csrf) | createCsrfMiddleware, @getstrata/bootstrap:createCsrfProtection | `unit/csrf.test.ts` |
| ✅ covered | laravel | [Controllers](https://laravel.com/docs/controllers) | withErrorHandling, jsonResponse, RouteHandler | `unit/httpKernel.test.ts` |
| ✅ covered | laravel | [Form Requests](https://laravel.com/docs/validation#form-request-validation) | FormRequest, WebFormRequest, validateObject… | `unit/formRequest.test.ts` |
| ✅ covered | laravel | [Views](https://laravel.com/docs/views) | EtaViewEngine, htmlResponse, resolveWebLayoutData… | `unit/etaViewEngine.test.ts` |
| ✅ covered | laravel | [Validation](https://laravel.com/docs/validation) | ValidationError, validateObject, minLength… | `unit/validationRules.test.ts` |
| ✅ covered | laravel | [Error Handling](https://laravel.com/docs/errors) | NotFoundError, ForbiddenError, UnauthorizedError… | `unit/databaseErrors.test.ts` |
| ✅ covered | laravel | [Database: Getting Started](https://laravel.com/docs/database) | bindDatabaseConnection, getActiveDatabaseConnection, runWithDatabaseConnection | `unit/databaseConnection.test.ts` |
| ✅ covered | laravel | [Query Builder](https://laravel.com/docs/queries) | RepositoryQuery, WhereBuilder, BaseRepository | `unit/database/queryBuilder.test.ts` |
| ✅ covered | laravel | [Pagination](https://laravel.com/docs/pagination) | paginatedResponse, parsePaginationQuery, toPaginatedResourceCollection | `unit/pagination.test.ts` |
| ✅ covered | laravel | [Migrations](https://laravel.com/docs/migrations) | migrateDatabase, rollbackDatabase, freshDatabase… | `unit/migrationRunner.test.ts` |
| ✅ covered | laravel | [Schema Builder](https://laravel.com/docs/migrations#tables) | Schema, Blueprint, defineTable… | `unit/database/schema/grammarSnapshots.test.ts` |
| ✅ covered | laravel | [Database Seeding](https://laravel.com/docs/seeding) | runSeedersFromDirectory, loadSeedersFromDirectory | `unit/frameworkPublicApi.test.ts` |
| ✅ covered | laravel | [Eloquent: Getting Started](https://laravel.com/docs/eloquent) | Model, registerModelRepository, filterMassAssignable… | `unit/database/model.test.ts` |
| ✅ covered | laravel | [Eloquent: Relationships](https://laravel.com/docs/eloquent-relationships) | hasMany, hasOne, belongsTo… | `unit/database/model.relationships.test.ts` |
| ✅ covered | laravel | [Eloquent: Soft Deleting](https://laravel.com/docs/eloquent#soft-deleting) | Model | `unit/database/model.softDelete.test.ts` |
| ✅ covered | laravel | [Eloquent: API Resources](https://laravel.com/docs/eloquent-resources) | JsonResource, ResourceCollection, whenLoaded… | `unit/frameworkPublicApi.test.ts` |
| ✅ covered | laravel | [Eloquent: Factories](https://laravel.com/docs/eloquent-factories) | Factory | `unit/factory.test.ts` |
| ✅ covered | laravel | [Authorization](https://laravel.com/docs/authorization) | Policy, PolicyGate, createAuthorizeMiddleware | `unit/policy.test.ts` |
| ✅ covered | laravel | [Authentication](https://laravel.com/docs/authentication) | createAuthMiddleware, createRequireAuthMiddleware, currentAuthUser | `unit/authMiddleware.test.ts` |
| ✅ covered | laravel | [Route Model Binding](https://laravel.com/docs/routing#route-model-binding) | securedBindRouteModel, securedBindRouteModelByKey, @getstrata/bootstrap:securedBindRouteModel… | `unit/securedRouteModelBinding.test.ts` |
| ✅ covered | laravel | [URLs](https://laravel.com/docs/urls#signed-urls) | temporarySignedUrl, signedUrl, hasValidSignature… | `unit/signedUrl.test.ts` |
| ✅ covered | laravel | [Events](https://laravel.com/docs/events) | EventBus, events | `unit/events.test.ts` |
| ✅ covered | laravel | [Queues](https://laravel.com/docs/queues) | Job, RedisQueue, QueueWorker… | `unit/queue.test.ts` |
| ✅ covered | laravel | [Queues: Dealing With Failed Jobs](https://laravel.com/docs/queues#dealing-with-failed-jobs) | FailedJobService, FailedJobRepository, createFailedJobService | `unit/failedJobService.test.ts` |
| ✅ covered | laravel | [Task Scheduling](https://laravel.com/docs/scheduling) | Schedule, appSchedule, runDueScheduledTasks | `unit/schedule.test.ts` |
| ✅ covered | laravel | [Cache](https://laravel.com/docs/cache) | CacheRepository, CACHE_TAGS, @getstrata/bootstrap:cacheTagsForModelWrite… | `unit/cacheRepository.test.ts` |
| ✅ covered | laravel | [Rate Limiting](https://laravel.com/docs/routing#rate-limiting) | createThrottleMiddleware, createMemoryThrottleMiddleware, createLoginThrottleMiddleware | `unit/throttleMiddleware.test.ts` |
| ✅ covered | laravel | [File Storage](https://laravel.com/docs/filesystem) | StorageManager, LocalStorageDriver, storage | `unit/storage.test.ts` |
| ✅ covered | laravel | [Mail](https://laravel.com/docs/mail) | Mailer, LogMailDriver, mailer… | `unit/mailer.test.ts` |
| ✅ covered | laravel | [Database: Transactions](https://laravel.com/docs/database#database-transactions) | runInTransaction | `unit/database.test.ts` |
| ✅ covered | laravel | [Deployment: Graceful Shutdown](https://laravel.com/docs/deployment) | installGracefulShutdownSignals, registerShutdownHandler, runGracefulShutdown | `unit/gracefulShutdown.test.ts` |
| ✅ covered | partial | [Observability](https://laravel.com/docs/logging) | PrometheusRegistry, prometheusRegistry, createMetricsMiddleware | `unit/metrics.test.ts` |
| ✅ covered | laravel | [HTTP: Conditional Requests](https://laravel.com/docs/requests) | assertIfMatch, etagFromResource, isEtagEnabled | `unit/etag.test.ts` |
| ✅ covered | laravel | [Session](https://laravel.com/docs/session) | @getstrata/bootstrap:CookieSessionStore, @getstrata/bootstrap:createWebServer | `unit/sessionCookie.test.ts` |
| ✅ covered | laravel | [Query Builder: Chunks / Cursors](https://laravel.com/docs/queries#chunking-results) | BaseRepository | `unit/database/repositoryPhase3.test.ts` |
| ✅ covered | partial | [Billing Webhooks](https://laravel.com/docs/billing) | verifyStripeWebhook via @getstrata/core/security/stripeWebhook subpath | `unit/stripeWebhook.test.ts` |
| ✅ covered | laravel | [Eloquent: Polymorphic Relations](https://laravel.com/docs/eloquent-relationships#polymorphic-relationships) | morphTo, morphMany, morphOne… | `unit/database/morphRelations.test.ts` |
| ✅ covered | laravel | [Notifications](https://laravel.com/docs/notifications) | Notification, NotificationDispatcher, createNotificationDispatcher | `unit/notifications.test.ts` |
| ✅ covered | laravel | [Mail: Markdown Templates](https://laravel.com/docs/mail#markdown-mailables) | renderMarkdownMail, buildMarkdownMailMessage, sendMarkdownMail… | `unit/markdownMail.test.ts` |
| ✅ covered | stand-in | [Queue dashboard (not Laravel Horizon)](https://laravel.com/docs/horizon) | collectQueueMetrics, FailedJobService, FailedJobRepository… | `unit/queueMetrics.test.ts` |
| ✅ covered | stand-in | [Admin resources (not Laravel Nova)](https://laravel.com/docs/nova) | AdminResourceRegistry, formatAdminValue | `unit/adminRegistry.test.ts` |
| ✅ covered | stand-in | [Artisan Console](https://laravel.com/docs/artisan) | Strata CLI schedule:run — not part of the @getstrata/bootstrap public API | `unit/bootstrapSchedule.test.ts` |
