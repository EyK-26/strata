# Laravel parity audit

Generated: 2026-09-03T10:09:53.985Z

API catalog score means each Laravel doc section has a Strata export and a test.
Design score means the call shape matches Laravel, routed to TypeScript/Bun.
Stand-in is not design-complete. See `docs/DESIGN-PARITY.md`.

## Score

| Metric | Value |
|--------|-------|
| **API catalog score** | **100%** |
| **Design parity score** | **3.2%** |
| Core sections | 47 |
| API covered | 47 |
| API partial | 0 |
| API gaps | 0 |
| Design laravel | 0 |
| Design partial | 3 |
| Design stand-in | 44 |

CI target: ≥99% API catalog score. Design score is the real Laravel-similarity goal.

## Core matrix

| Status | Design | Laravel section | Strata API | Tests |
|--------|--------|-----------------|------------|-------|
| ✅ covered | stand-in | [Service Container](https://laravel.com/docs/container) | ServiceContainer, resolveService, @getstrata/bootstrap:ServiceContainer… | `unit/providers.test.ts` |
| ✅ covered | stand-in | [Service Providers](https://laravel.com/docs/providers) | @getstrata/bootstrap:ServiceProvider, @getstrata/bootstrap:runProviderPhase, @getstrata/bootstrap:collectProviders… | `unit/providers.test.ts` |
| ✅ covered | stand-in | [Facades](https://laravel.com/docs/facades) | cache, queue, events… | `unit/events.test.ts` |
| ✅ covered | stand-in | [Routing](https://laravel.com/docs/routing) | applyMiddlewareToRoutes, withMiddleware, composeMiddleware… | `unit/httpKernel.test.ts` |
| ✅ covered | stand-in | [Middleware](https://laravel.com/docs/middleware) | createCsrfMiddleware, createSecurityHeadersMiddleware, createBodySizeLimitMiddleware… | `unit/csrf.test.ts` |
| ✅ covered | stand-in | [CSRF Protection](https://laravel.com/docs/csrf) | createCsrfMiddleware, @getstrata/bootstrap:createCsrfProtection | `unit/csrf.test.ts` |
| ✅ covered | stand-in | [Controllers](https://laravel.com/docs/controllers) | withErrorHandling, jsonResponse, RouteHandler | `integration/routes.integration.test.ts` |
| ✅ covered | stand-in | [Form Requests](https://laravel.com/docs/validation#form-request-validation) | FormRequest, WebFormRequest, validateObject… | `unit/formRequest.test.ts` |
| ✅ covered | stand-in | [Views](https://laravel.com/docs/views) | EtaViewEngine, htmlResponse, resolveWebLayoutData… | `unit/etaViewEngine.test.ts` |
| ✅ covered | stand-in | [Validation](https://laravel.com/docs/validation) | ValidationError, validateObject, minLength… | `unit/validationRules.test.ts` |
| ✅ covered | stand-in | [Error Handling](https://laravel.com/docs/errors) | NotFoundError, ForbiddenError, UnauthorizedError… | `unit/databaseErrors.test.ts` |
| ✅ covered | stand-in | [Database: Getting Started](https://laravel.com/docs/database) | bindDatabaseConnection, getActiveDatabaseConnection, runWithDatabaseConnection | `unit/databaseConnection.test.ts` |
| ✅ covered | stand-in | [Query Builder](https://laravel.com/docs/queries) | RepositoryQuery, WhereBuilder, BaseRepository | `unit/database/queryBuilder.test.ts` |
| ✅ covered | stand-in | [Pagination](https://laravel.com/docs/pagination) | paginatedResponse, parsePaginationQuery, toPaginatedResourceCollection | `unit/pagination.test.ts` |
| ✅ covered | stand-in | [Migrations](https://laravel.com/docs/migrations) | migrateDatabase, rollbackDatabase, freshDatabase… | `unit/migrationRunner.test.ts` |
| ✅ covered | stand-in | [Schema Builder](https://laravel.com/docs/migrations#tables) | Schema, Blueprint, defineTable… | `unit/database/schema/grammarSnapshots.test.ts` |
| ✅ covered | stand-in | [Database Seeding](https://laravel.com/docs/seeding) | runSeedersFromDirectory, loadSeedersFromDirectory | `unit/frameworkPublicApi.test.ts` |
| ✅ covered | partial | [Eloquent: Getting Started](https://laravel.com/docs/eloquent) | Model, registerModelRepository, filterMassAssignable… | `unit/database/model.test.ts` |
| ✅ covered | partial | [Eloquent: Relationships](https://laravel.com/docs/eloquent-relationships) | hasMany, hasOne, belongsTo… | `unit/database/model.relationships.test.ts` |
| ✅ covered | stand-in | [Eloquent: Soft Deleting](https://laravel.com/docs/eloquent#soft-deleting) | Model | `unit/database/model.softDelete.test.ts` |
| ✅ covered | stand-in | [Eloquent: API Resources](https://laravel.com/docs/eloquent-resources) | toResourceCollection, serializeDate, toPaginatedResourceCollection | `unit/frameworkPublicApi.test.ts` |
| ✅ covered | partial | [Eloquent: Factories](https://laravel.com/docs/eloquent-factories) | Factory | `unit/factory.test.ts` |
| ✅ covered | stand-in | [Authorization](https://laravel.com/docs/authorization) | Policy, PolicyGate, createAuthorizeMiddleware | `unit/policy.test.ts` |
| ✅ covered | stand-in | [Authentication](https://laravel.com/docs/authentication) | createAuthMiddleware, createRequireAuthMiddleware, currentAuthUser | `unit/authService.test.ts` |
| ✅ covered | stand-in | [Route Model Binding](https://laravel.com/docs/routing#route-model-binding) | securedBindRouteModel, securedBindRouteModelByKey, @getstrata/bootstrap:securedBindRouteModel… | `unit/securedRouteModelBinding.test.ts` |
| ✅ covered | stand-in | [URLs](https://laravel.com/docs/urls#signed-urls) | temporarySignedUrl, signedUrl, hasValidSignature… | `unit/signedUrl.test.ts` |
| ✅ covered | stand-in | [Events](https://laravel.com/docs/events) | EventBus, events | `unit/events.test.ts` |
| ✅ covered | stand-in | [Queues](https://laravel.com/docs/queues) | Job, RedisQueue, QueueWorker… | `unit/queue.test.ts` |
| ✅ covered | stand-in | [Queues: Dealing With Failed Jobs](https://laravel.com/docs/queues#dealing-with-failed-jobs) | FailedJobService, FailedJobRepository, createFailedJobService | `unit/failedJobService.test.ts` |
| ✅ covered | stand-in | [Task Scheduling](https://laravel.com/docs/scheduling) | Schedule, appSchedule, runDueScheduledTasks | `unit/schedule.test.ts` |
| ✅ covered | stand-in | [Cache](https://laravel.com/docs/cache) | CacheRepository, CACHE_TAGS, @getstrata/bootstrap:cacheTagsForModelWrite… | `unit/cacheRepository.test.ts` |
| ✅ covered | stand-in | [Rate Limiting](https://laravel.com/docs/routing#rate-limiting) | createThrottleMiddleware, createMemoryThrottleMiddleware, createLoginThrottleMiddleware | `unit/throttleMiddleware.test.ts` |
| ✅ covered | stand-in | [File Storage](https://laravel.com/docs/filesystem) | StorageManager, LocalStorageDriver, storage | `unit/storage.test.ts` |
| ✅ covered | stand-in | [Mail](https://laravel.com/docs/mail) | Mailer, LogMailDriver, mailer… | `unit/mailer.test.ts` |
| ✅ covered | stand-in | [Database: Transactions](https://laravel.com/docs/database#database-transactions) | runInTransaction | `unit/database.test.ts` |
| ✅ covered | stand-in | [Deployment: Graceful Shutdown](https://laravel.com/docs/deployment) | installGracefulShutdownSignals, registerShutdownHandler, runGracefulShutdown | `unit/gracefulShutdown.test.ts` |
| ✅ covered | stand-in | [Observability](https://laravel.com/docs/logging) | PrometheusRegistry, prometheusRegistry, createMetricsMiddleware | `unit/metrics.test.ts` |
| ✅ covered | stand-in | [HTTP: Conditional Requests](https://laravel.com/docs/requests) | assertIfMatch, etagFromResource, isEtagEnabled | `unit/etag.test.ts` |
| ✅ covered | stand-in | [Session](https://laravel.com/docs/session) | @getstrata/bootstrap:CookieSessionStore, @getstrata/bootstrap:createWebServer | `unit/sessionCookie.test.ts` |
| ✅ covered | stand-in | [Query Builder: Chunks / Cursors](https://laravel.com/docs/queries#chunking-results) | BaseRepository | `unit/database/repositoryPhase3.test.ts` |
| ✅ covered | stand-in | [Billing Webhooks](https://laravel.com/docs/billing) | verifyStripeWebhook via @getstrata/core/security/stripeWebhook subpath | `unit/stripeWebhook.test.ts` |
| ✅ covered | stand-in | [Eloquent: Polymorphic Relations](https://laravel.com/docs/eloquent-relationships#polymorphic-relationships) | morphTo, morphMany, morphOne… | `unit/database/morphRelations.test.ts` |
| ✅ covered | stand-in | [Notifications](https://laravel.com/docs/notifications) | Notification, NotificationDispatcher, createNotificationDispatcher | `unit/notifications.test.ts` |
| ✅ covered | stand-in | [Mail: Markdown Templates](https://laravel.com/docs/mail#markdown-mailables) | renderMarkdownMail, buildMarkdownMailMessage, sendMarkdownMail… | `unit/markdownMail.test.ts` |
| ✅ covered | stand-in | [Queue dashboard (not Laravel Horizon)](https://laravel.com/docs/horizon) | collectQueueMetrics, FailedJobService, FailedJobRepository… | `unit/adminServiceMetrics.test.ts` |
| ✅ covered | stand-in | [Admin resources (not Laravel Nova)](https://laravel.com/docs/nova) | AdminResourceRegistry, formatAdminValue | `unit/adminRegistry.test.ts` |
| ✅ covered | stand-in | [Artisan Console](https://laravel.com/docs/artisan) | WorkHub CLI schedule:run — not part of the @getstrata/bootstrap public API | `unit/bootstrapSchedule.test.ts` |
