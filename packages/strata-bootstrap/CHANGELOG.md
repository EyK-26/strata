# @getstrata/bootstrap changelog

## 2.2.26

Fix complete safe integer validation with optional strict JSON-number input; add scoped read-only outbox delivery inspection; add typed grouped sums with exact textual totals, protected predicates and dialect/RLS regressions.

## 2.2.25

Queue worker run loops recover native Redis connection closure with bounded backoff and a fresh connection. Uncertain Redis mutations are not replayed; retained reservations and retries use normal recovery. Explicit closure remains terminal and non-connection errors remain fatal. Native poll/ack closure regressions cover Streams and list transports.

## 2.2.24

Fix Redis cache recovery after transport failures and command deadlines: retire failed connections, abort active fills, and lazily reconnect for later operations without replaying uncertain commands; preserve permanent explicit closure and shared invalidation fencing.

## 2.2.23

Fix native SMTP hangs with bounded whole-send deadlines, cancellation, buffered multiline replies, complete writes and verified implicit TLS. Preserve known final DATA acceptance through cleanup failures. Correct DATA transparency, CRLF, UTF-8 MIME/header encoding and long-line framing; reject incomplete AUTH and unsupported SMTPUTF8 envelopes explicitly. Generate documented SMTP timeout and TLS defaults. Real socket/TLS/protocol regressions cover outages, cancellation, accepted sends and framing; SMTP delivery before final acknowledgement remains uncertain.

## 2.2.22

Preserve caller auth, credential sources, request metadata and application async stores through cold/queued native transaction callbacks. Serialize Postgres privilege grants with full provisioning using atomic database-scoped batches, retaining delegated-admin permissions and rollback/retry safety. Add real constrained-pool JSON/HTML bearer/session-CSRF and concurrent grant/atomicity regressions; no automatic workers, auth bypass or production runtime provisioning.

## 2.2.21

Make registered queue/outbox workers discoverable in CLI help and generated startup guidance. Announce polling after boot and when it stops without claiming dependency health, printing secrets, or starting workers automatically. Preserve explicit process ownership, delivery semantics and graceful lifecycle; cover idle, boot/runtime/cleanup failures and real SIGTERM draining.

## 2.2.20

Validate complete migration definitions before callbacks, locks or database effects; reject malformed exports and duplicate names with source diagnostics. Refuse fresh with missing applied definitions and rollback with incomplete latest batches; preserve partial forward migration and remove blanket history deletion. Cover physical schema/data/history preservation and reset recovery on real Postgres, MySQL and SQLite, plus loader and preflight regressions; document safe missing-file recovery and unchanged atomicity limits.

## 2.2.19

Fix explicit development fresh resets with unfinished outbox deliveries while preserving ordinary rollback guards. Record each completed reset down immediately so later refusal leaves recoverable migration progress; document partial-DDL/crash limits and old-history reconciliation. Add independent outbox-state and reset failure/migrate/retry regressions on real Postgres, MySQL and SQLite, history-write/reapplication fault injection, and a documented stateful regression review flow.

## 2.2.18

Add optional typed guardMigrationRollback for application-owned rollback history predicates; skip history reads only during explicit development fresh resets, propagate predicate failures, and reuse the contract for encryption-checkpoint archival protection. Document guard placement and unchanged reset/rollback safety; cover type, runner and real SQLite history regressions.

## 2.2.17

Add explicit development-only migration reset context while preserving guarded rollback and encryption archival; align generated fresh entries and reject production/staging or unsupported reset arguments before provisioning. Replace CSP-blocked error-page JavaScript navigation with safe same-origin links, and correct ambiguous Postgres/SQLite foreign-key messages without changing their HTTP status.

## 2.2.16

Allow managed outbox workers to reuse a configured instance, preserving application tenant resolution, listener registration and delivery settings. Keep generated listeners-only defaults compatible, reject ambiguous worker sources, and cover configured SQL delivery, cancellation, cleanup and TypeScript contracts.

## 2.2.15

- Batch legacy list-queue priority polling while retaining recovery and ownership contracts.
- Batch dialect-portable pivot writes with framework transaction/savepoint composition and consistent numeric/string ID toggle semantics. Noncanonical or textual IDs use sequential database comparisons to preserve coercion and collation behavior.
- New Redis scaffolds explicitly select Streams; existing unset transport settings continue to select lists.
- Generate the SQL outbox migration, listener registry and managed worker command. Durable publication and cache-invalidation activation remain explicit.

- Primary-key ascending `chunk` queries reuse the existing keyset walk, including default primary-key ordering; projections, joins, grouping, locks and other orders retain OFFSET behavior.
- Empty filtered pagination totals skip the row query. Nonempty page-number pagination preserves OFFSET semantics and its count-plus-row-query budget; explicit cursor/keyset APIs remain available for deep traversal.
- Independent hashed write casts run concurrently. Deterministic regressions prove concurrent start, complete awaiting and failure before model observers or SQL writes; hydration and existing-hash behavior are preserved.
- Streams workers poll retry promotion, pending recovery and new delivery across priorities in one bounded Redis script, preserving priority, ownership fencing and at-least-once delivery contracts.
- Clarify historical 2.1.0–2.2.13 release notes and database/queue documentation. Remove the consolidated 1.x-to-2.x migration guide; existing projects are upgraded individually.

## 2.2.14

Complete the scoped HTML rendering starter adoption: generated apps inject ViewRenderer through createViewProvider instead of copying renderPage; welcome pages opt into HTMX fragments with full-page fallbacks, auth retains existing contracts, and CORS preserves representation Vary headers. Includes generator, runtime auth and cache-header regressions.

Add optional typed resourceRoutes and strict mergeRouteMaps composition, preserving native Bun routing and app-owned middleware. Add explicit ViewRenderer.namespace prefixes with unchanged layout/Response/HTMX contracts; generated auth controllers use the namespace. Includes native HTTP, compile-time, rendering isolation and generator regressions.

## 2.2.13

- Add a typed per-app HTML renderer on top of the native response path.
- Add explicit HTMX page and fragment responses. A fragment can fall back to the full page. Layout and auth response contracts stay the same.

## 2.2.12

- Require Bun >=1.4.3; align CI, generated/existing example runtime pins and Docker stages to 1.4.3, with bun-types >=1.4.3 behind the official @types/bun shim.

Add identified field-encryption keyrings, reader-first email/MFA configuration, and explicit transactional maintenance rotation for ciphertext and lookup keys with durable checkpoints, RLS scopes, fresh retirement audits and backup/rollback guidance. Fix SQLite primary-key compilation for non-generated keys. Preserve legacy auth defaults; no automatic data migration.

## 2.2.11

Add independently interruptible read-only SQLite and MySQL observations; extend bounded failed-job and outbox metrics to file-backed SQLite and URL-backed MySQL with schema/index guards, real-engine regressions and three-process consistency tests. Preserve Postgres RLS and business transaction behavior.

## 2.2.10

- Add bounded OpenTelemetry SDK health observations and selected native transaction-acquisition histograms through explicit metrics options.
- Add bounded Postgres failed-job counts using ORM ID projections, with schema guards, native acquisition deadlines and read-only collector draining.
- Observe Streams retry promotion lateness using Redis time; cancellation cleanup sentinels omit unavailable age instead of reporting age since epoch.
- Generate typed runtimeMetrics opt-in and provider-owned SQL collector draining, including startup cleanup; HTTP-only defaults and borrowed tracing ownership remain intact.
- Keep additional SQL observation dialects, sustained operational qualification and encryption rotation explicit follow-up work.

## 2.2.9

- Pool checkout can be cancelled. `reserve({ signal })` on the native driver aborts while it is still waiting for a connection. Drivers without that method are not given a fake one.

## 2.2.8

- Add bounded, read-only Postgres outbox metrics.
- Add bounded, opt-in Redis queue metrics. List and Streams depth stay separate.

## 2.2.7

- `ORDER BY` accepts explicit `nulls: "first" | "last"`. Postgres and SQLite emit `NULLS FIRST` / `NULLS LAST`. MySQL has no `NULLS FIRST` / `NULLS LAST` clause, so it orders nulls with an `IS NULL` discriminator and leaves the rest of the sort unchanged.

## 2.2.6

- The CLI, when it supervises the app or worker as a child, forwards shutdown signals to that child and waits for it. The container launcher no longer exits while the child is still running.

## 2.2.5

- Container readiness no longer means the API is admitting traffic. Database readiness no longer provisions roles or creates a missing database. A failed configured admin connection does not fall back to a generated password.

## 2.2.4

- Composite keyset pages on Postgres seek with a row comparison (`(a, b) > (cursor)`), so the planner can start at the index bound instead of expanding the cursor into a chain of OR predicates.

## 2.2.3

- Add scoped composite keyset pagination. The order must end with the primary key. Global scopes and caller filters stay in force across the cursor. Joins, grouping, and offset queries are rejected.

## 2.2.2

- Schema `bigId` emits an explicit 64-bit generated identity.
- Repository writes can be conditional and set-based.
- Repositories and models can take a typed row lock inside the current transaction.
- Generated Postgres query handles keep tagged-SQL typing.

## 2.2.1

- Opt-in Redis Streams (`QUEUE_REDIS_TRANSPORT=streams`). Lists stay the default. Streams adds consumer-group recovery, persisted retry schedules, total job deadlines, opt-in cancellation, and a stable job id across replay. Conversion from lists is a stopped maintenance step.
- Failed jobs stay recorded until retry admission succeeds. Manual replay keeps `failed_job.job_id` when the row has one.
- Public reads and tenant host selection are separate. Unknown hosts fail closed. Forwarded hosts are accepted only from configured trusted proxies.
- Generated apps can provision one initial administrator with `auth:provision-admin` and a one-time claim migration. Demo seeding stays explicit and is rejected in production and staging.
- Quota and in-memory throttle docs match the code: memory throttles stay process-local, and a Redis failure does not fall back to them.

## 2.2.0

Consistent model scopes.
Changed-field model writes.
Awaited provider startup.
Shared cache correctness.
Native HTTP controls and body limits.
Graceful lifecycle.
Validated async discovery.
Stronger model input types.
OpenTelemetry tracing.
Distributed scheduler ownership.
App-owned quota policy.
Bounded memory throttling.

## Unreleased

- Provide shared tracing provider ownership and phased OpenTelemetry flush/shutdown without replacing application global tracer providers.

- Breaking source contract: `discoverJobs()` and `discoverListeners()` now return promises. Await ESM discovery before queue construction or listener boot; malformed exports and duplicate discovered identities fail visibly. Add explicit job/listener/module manifests for bundles, preserve custom job factories, evict failed discovery loads and protect publication after reset. See `docs/DISCOVERY.md` before release/adoption.

- Make provider startup awaited, register all providers before boot, and expose idempotent context disposal with failure cleanup. Direct startup helper callers must now await; appContext getters require completed startup.

- Add awaited model discovery with nested exports, two-phase naming/boot, duplicate-name detection and startup error propagation.

## 2.1.0

- Generated apps reuse the shared config store and base repositories instead of a copied stack.
- Password casts are awaited before the write reaches SQL or observers. Hydration does not hash.
- Model queries keep the concrete model type in their results. Service tokens, route handlers, and the starter's generated infrastructure were tightened in the same release.

## 2.0.9

- fix(starter): remove demo credentials from public login defaults

## 2.0.8

- fix(schema): preserve constraints and generate builder migrations

## 2.0.7

- Fix concurrent Postgres role provisioning across databases

## 2.0.6

- Dispatch registered Bun route preflights through CORS

## 2.0.5

- Allow explicitly approved application headers in CORS

## 2.0.4

- Place cache rollout guidance beside outbox docs without overlapping API additions

## 2.0.3

- Persist transactional events with leased tenant-aware SQL outbox workers

## 2.0.2

- Adopt TypeScript 7.0.2 in framework and generated apps; preserve tested TypeScript 5.9 and 6.x consumer compatibility.
- Verify six generated app configurations against three compiler versions and typecheck/build React SPA and hybrid frontends.
- Declare Bun-supported CSS imports in the SPA scaffold for TypeScript 7.

## 2.0.1

- Fix release lockfile drift and CLI 2.x peer compatibility

## 2.0.0

- Strata 2.0: compose business transactions and tenant scopes

## 1.1.9

- Defer model events until the surrounding transaction commits

## 1.1.8

- Exclude HTML and SPA routes from generated OpenAPI specs

## 1.1.7

- Fix generated webhook SQL, billing hook, and hybrid SPA smoke

## 1.1.6

- Add optional OIDC cookie login and loopback discovery

## 1.1.5

- Close dogfood gaps: webhook docs, starter extras, signing helper

## Unreleased

- Docs no longer mention `registerWebhookJobs()`. Default jobs stay `cache.invalidate-tags` and `audit.export`. Apps discover `src/jobs/*.ts` with `discoverJobs()` (generated `--webhooks` registers `webhook.dispatch`).

## 1.1.4

- Publish http/uploads, validateUploadFile, migration-adoption docs

## 1.1.3

- Eager with() arrays, OpenAPI mkdir, public-read/auth docs

## 1.1.2

- Product CLI helpers, file migrations, and job discovery.

## Unreleased

- `discoverJobs()` loads `src/jobs/*.ts` default exports with `static jobName` into `jobRegistry`, same cache pattern as `discoverListeners()`.
- Queue providers register default jobs and discovered jobs together.

## 1.1.1

Fix generated app boot

## 1.1.0

Lockstep with `@getstrata/core` 1.1.0. Cookie sessions select `s.created_at AS session_created_at` so `users.created_at` from `u.*` cannot clobber the session issued-at. API group always includes session-mutating CSRF. `buildModuleRoutes` maps thrown API middleware errors (including CSRF `ForbiddenError`) to JSON. `HttpKernel.wrap("api")` does the same for routes used outside that builder. Path confinement on the web server and safer production defaults. The rls role denylist checks the runtime URL (`APP_DATABASE_URL` when set, otherwise `DATABASE_URL`) so fixture admin `DATABASE_URL` can stay `postgres`.

## 1.0.9

Label HiroApp as internal e2e dogfood and seed notes via Model

## 1.0.8

- Container image starts and ships production dependencies only.

## 1.0.7

## 1.0.6

- Lockstep with `create-strata` 1.0.6. No runtime changes.

## 1.0.5

- Lockstep with `create-strata` 1.0.5. No runtime changes.

## 1.0.4

- `assertProductionSecrets()` uses `isProductionEnv()`, so `NODE_ENV=production`, `APP_ENV=Production`, and `APP_ENV=staging` cannot skip the guard.
- Feature flags parse with `envFlagEnabled()` (`=== "true"` only).

## 1.0.3

- Lockstep with `create-strata` 1.0.3. No runtime changes.

## 1.0.2

- Lockstep with `create-strata` 1.0.2. No runtime changes.

## 1.0.1

- `assertProductionSecrets()` rejects secrets still holding a generated `change-me` placeholder. The shipped `SESSION_SECRET` placeholder was 38 characters, so it passed the length check and booted in production unchanged.
- Cookie sessions write timestamps through the active dialect, so `CookieSessionStore.create()` works on MySQL.
- Removed the `createRoutes` subpath. It was in-repo fixture HTTP, documented as not an app API, and it packed a stray `dist/_.._/_.._/index.html` asset and dogfood helpers into the tarball.
- Removed leftover third-party product token strings from the production blocklist.
- `assertProductionSecrets()` requires `APP_URL` to be a public `http(s)` origin (localhost rejected, plain http warns). Signed links and redirects are built from it.
- `createWebServer()` records the socket address (IPv4-mapped addresses normalized) in the request context, so throttles, request logs, and session rows see the real client.
- `CookieSessionAuthManager.signIn()` fills `ip_address` and `user_agent` from the request context when the caller passes no meta. The `Secure` cookie flag now keys on `APP_ENV=production` (or `NODE_ENV`), matching the rest of the framework; generated apps never set `NODE_ENV`, so production cookies were not marked `Secure`.
- `engines.bun` is declared.

## 1.0.0

- First stable release of `@getstrata/bootstrap`.

## 0.4.3

- Cookie session `mapUser` / row mapping can pass `email_verified_at` through as `emailVerifiedAt` so HTML email verification works.
- Session insert binds `expires_at` as an ISO string so SQLite cookie login does not fail parameter binding.

## 0.4.2

- `HttpKernel.wrapApi` uses `withJsonErrorHandling`. Hybrid views do not turn API errors into HTML.

## 0.4.1

- `createSpaRoutes` reads `SPA_PREFIX`, registers `prefix`, `prefix/`, and `prefix/*`, and accepts `distDirectory` plus `wrap`. Hybrid still does not redirect `/`.
- `appEnvSchema` defaults `SPA_PREFIX` from core `DEFAULT_SPA_PREFIX`.
- Peer `@getstrata/core` `^0.7.1`.

## 0.4.0

- Peer `@getstrata/core` `^0.7.0`.
- Production `SESSION_SECRET` is required whenever views are on (`FRONTEND_MODE=server-htmx` or `hybrid`).
- Hybrid SPA routes stay under `/app/*`. They do not redirect `/`, so HTML at `/` keeps the home path.
- `appEnvSchema` validates `FRONTEND_MODE` with the core pattern, including `hybrid`.
- `HttpKernel.wrapApi` maps thrown HTTP errors to JSON the same way `wrapWeb` maps them to HTML.

## 0.3.0

- Peer `@getstrata/core` `^0.6.0`.
- Cookie session SQL uses the current SQL dialect for placeholders, `NOW()`, and `NULLS LAST`.
- Kernel helpers cover guest, verified-email, and password-confirm gates.

## 0.2.68

- `configureModulesDirectory()` clears the discovered-module cache when the directory changes, so OpenAPI/`createApp` can load HiroApp after core tests pointed at empty fixtures.
- `createWebRoutes()` / `mergeWebRoutes()` accept optional `{ modules }` so leftover bootstrap route assembly does not pick up the dogfood app's modules. `CreateWebRoutesOptions` is exported from the public API.

## 0.2.67

- `CookieSessionStore.create()` records optional browser metadata (`userAgent`, `ipAddress`, `last_active_at`).
- `CookieSessionStore` can list live sessions, touch `last_active_at`, and destroy every session except the current cookie (`listForUser`, `touch`, `destroyOtherSessions`).
- `CookieSessionAuthManager.signIn()` / `signInRedirect()` accept the same metadata. Apps that use cookie sessions (HiroApp) must have `user_agent`, `ip_address`, and `last_active_at` on `sessions`.

## 0.2.66

- `assertProductionSecrets()` is feature-gated for every app. API tokens no longer imply HiroApp's encryption/CORS/OAuth/public-read checklist. Published test token strings are still denied. HiroApp's extra production profile lives in the app (`src/config/productionSecrets.ts`).
- **Breaking:** `HttpKernel.wrapWebGuest()` defaults `home` to `/` instead of `/organizations`. Apps with an org home should pass that path (HiroApp already does).
- `createWebRoutes()` no longer seeds a `/` → `/organizations` redirect. The in-repo app owns `/` via its organization module.

## 0.2.65

- App listener discovery reads `src/listeners` from `process.cwd()` so a built `@getstrata/bootstrap` bundle still finds HiroApp registrars (`import.meta.dir` after `build:bootstrap` is the package dist). Listener boot calls each registrar every time (registrars are idempotent per `eventBus`).

## 0.2.64

- `registerDefaultJobs()` no longer registers HiroApp `webhook.dispatch`. Apps that dispatch model webhooks should call `registerWebhookJobs()` (HiroApp's webhook provider and `queue:work` do).

## 0.2.63

- `HttpKernel.wrapWebGuest()` `home` accepts `string | ((user) => string | Promise<string>)` so signed-in guest redirects can follow the current team. Default remains `/organizations`.

## 0.2.62

- `HttpKernel.wrapWebPasswordConfirm()` is the HTML password-confirm gate. Peer `@getstrata/core` `^0.5.75`.

## 0.2.61

- `HttpKernel.wrapVerified()` / `wrapWebVerified()` / `wrapWebAuthenticatedAllowUnverified()`. When `FEATURE_EMAIL_VERIFICATION=true`, `wrapWebAuthenticated` and `wrapWebAbility` require a verified email. Peer `@getstrata/core` `^0.5.74`.

## 0.2.60

- Peer `@getstrata/core` `^0.5.73` for public OpenAPI email verification resend.

## 0.2.59

- `HttpKernel.wrapWebGuest()` sends signed-in HTML users to `/organizations` (override the home path). Peer `@getstrata/core` `^0.5.72`.

## 0.2.58

- Peer `@getstrata/core` `^0.5.71` for public OpenAPI `/auth/register`.

## 0.2.57

- Peer `@getstrata/core` `^0.5.70` for optional OAuth `redirectUri`.

## 0.2.56

- Peer `@getstrata/core` `^0.5.69` for `MembershipLookup.updateMemberRole`.

## 0.2.55

- HttpKernel and route builders read `isViewsEnabled` / `isSpaEnabled` from `@getstrata/core/runtime/frontendMode` instead of HiroApp `src/config/frontend`.

## 0.2.54

- `HttpKernel.wrapSigned()` applies `createValidateSignatureMiddleware` so HTMX routes can require a valid signed URL.

## 0.2.53

- `registerDefaultJobs()` also registers `audit.export` (`ExportAuditLogsJob`).
- In-process `audit-export` schedule runs that job instead of calling `exportPendingAuditLogs()` inline.

## 0.2.52

- View provider registers `configureWebErrorView` so `errors/*.eta` render through the app Eta layout. `EtaViewEngine` receives `Request` from the layout-data resolver.
- `createWebServer` unknown routes and null handlers return styled HTML 404s and run inside request ALS so `configureWebLayoutData` can read the session cookie.
- `wrapSecuredRouteModelByKey` is documented as the wrong default for public HTML show pages; a missing model is a styled 404 and HTML/composite GET ETags stay off.

## 0.2.51

- `createCookieSessionAuthManager` returns `CookieSessionAuthManager` (`signIn`, `signOut`, `signInRedirect`, `signOutRedirect`). Controllers no longer need a local cookie helper.
- Pass `loadSessionUser` to replace the default `users.learn_subscriber` / `users.is_admin` session query. Keep `mapUser` in the app.

## 0.2.50

- `createCookieSessionAuthManager` / `CookieSessionGuard` turn `CookieSessionStore` into an `AuthGuard` / `AuthManager` for `CORE_AUTH_TOKEN`. Supply a `mapUser` mapper; HiroApp abilities are not baked in. Omit `sql` to read the client from `bindDatabaseConnection()` on every call.
- `checkDatabase()` / `createHealthRoutes()` ping the bound database client, not HiroApp's private connection holder. `/health` stays `{ status: "ok" }` unless `{ pingOnHealth: true }`. Extra JSON fields are optional.
- `assertProductionSecrets()` is feature-gated. A production HTMX app with `SESSION_SECRET` (32+), `AUTH_DEV_HEADERS=false`, and feature flags off does not need HiroApp API tokens. HiroApp's current production env (rotated tokens, CORS, pepper, expiry) still passes.
- Re-exports `CORE_ABILITY_CHECKER_TOKEN` and `CORE_AUTH_USER_DIRECTORY_TOKEN`.
