# @getstrata/bootstrap changelog

## 2.2.54

- Preserve own native route parameter keys such as __proto__ as data properties instead of losing them through an inherited setter. Keep the ordinary object prototype, string coercion, Bun-owned decoding and native request identity.
- Align the core requirement with 2.2.54. No new route API or native asset admission/delivery or mixed HTTP/WebSocket behavior is introduced.

## 2.2.53

- Preserve Bun-native decoded route parameters without decoding them a second time. Literal percent identifiers remain valid, and encoded-looking identifiers retain the key Bun supplies before binding and authorization.
- Align the core requirement with 2.2.53. Native asset admission/delivery and mixed HTTP/WebSocket reporting limitations remain unchanged.

## 2.2.52

- Share response policy and observation middleware for explicitly public application documents without adding auth/tenant requirements.
- Allow an explicit view capability for browser SSO continuation in API/SPA applications; default view-provider behavior remains unchanged.
- Require aligned core 2.2.52. Native Bun asset admission/delivery and mixed HTTP/WebSocket reporting limitations remain unchanged.

## 2.2.51

- Resolve encoded static paths consistently across guarded server fallback, web routes and SPA assets, including HEAD and request-hook checks.
- Align core requirements with 2.2.51; retain native asset admission, Bun delivery and mixed HTTP/WebSocket abort-reporting limitations.

## 2.2.50

- Report an unsuccessful graceful drain when an admitted HTTP-only response aborts during shutdown, after waiting for outstanding application work. Preserve pre-shutdown disconnect handling and normal WebSocket shutdown.
- Retain the documented mixed HTTP/WebSocket reporting limitation and upstream Bun asynchronous-pipelining truncation limitation; no lossless native-assets support is claimed.
- Align the core peer requirement with 2.2.50.

## 2.2.49

- Supply the real shared conditional cache operation to API and web module contexts, preserving tags, ETags, invalidation and error recovery.
- Keep provider phase admission inside lifecycle ownership, retaining reverse cleanup, drain/flush/close ordering and shared application identity.
- Preserve native callback arguments and cloned Response routes, apply CSRF correctly to mixed method maps, and pair normalized route aliases with the winning handler's own metadata. Existing whole-path override precedence remains intact.
- Align core requirements with 2.2.49. Opaque native file/directory/HTML routes remain a known adapter limitation; this patch does not bypass request admission or introduce a public-assets API.

## 2.2.48

- Align the core peer requirement with 2.2.48 for strict environment validation, compatible repository contracts and dependency-cycle diagnostics. Existing HTTP kernel, module-context and provider contracts remain unchanged.

## 2.2.47

- Align the package version with the starter/CLI correction batch; no bootstrap runtime behavior changes.

## 2.2.46

- Align the core dependency with 2.2.46 for the validated SPA runtime namespace contract.

## 2.2.45

Offer optional Adminer consistently in Docker and Mix wizard modes when the selected database is in Compose. Generate debug-profile startup commands and complete database login instructions; correct noninteractive Docker documentation while preserving existing flag behavior. Add prompt/CLI regressions and real isolated MySQL/Postgres Adminer profile and login acceptance tests without removing assertions.

## 2.2.44

Generate JSON registration, verification/resend, reset and password-confirmed MFA for API/SPA cookie starters; share guarded MFA persistence with HTML, reject malformed TOTP secrets, and extend installed-app SMTP, replay, revocation and compiler coverage without changing HTML contracts.

Preserve private/no-store headers when the tenancy boundary maps an HTTP error to JSON, without changing its status/body or transaction rollback. Rebuild the starter in standalone generated-app verification to prevent stale output from producing false green results.

Honor the explicit API JSON error context during password confirmation even when a client sends HTML/HTMX headers; preserve automatic HTML behavior outside that context.

Use the shared JSON parser for signed password reset so malformed input is a controlled 400 and does not consume the reset proof.

## 2.2.43

Add `afterCommit` for process-local effects after the outermost managed transaction, sharing savepoint rollback and tenant replay with model events. Generated auth SMTP uses this boundary even inside RLS request transactions; callback failures propagate after commit without undoing persisted accounts. Durable delivery still requires the SQL outbox.

Fix MySQL verification/reset and session-revocation timestamps through the shared SQL dialect; make signup account and verification-token persistence atomic with SMTP after commit; initialize no-tenancy seed connections; add installed starter auth/SMTP/MFA/rollback journeys for every database and frontend, plus generated TypeScript profiles.

## 2.2.42

Generate auth JSON and forms with explicit private, no-store cache policy. Add privateJsonResponse and typed view namespace header defaults while preserving normal public defaults, native cookies, per-response overrides and HTMX representation behavior. Cover packed APIs and actual generated cookie/token/JWT/CSRF/profile/form HTTP responses.

Use the canonical error serializer for core JSON admission denials so authentication, policy/admin/ability, verification, password confirmation and body-limit failures retain no-store. Preserve exact status/message contracts, keep checker details private and retain HTML redirects/throws and successful response headers. Add packed producer regressions and a native detail-projection case.

## 2.2.41

Make framework HTML/JSON error responses non-storeable, including configured/fallback renderers and custom-body 404 responses; retain success-response cache policy and add packed header regressions.

Fix packaged error wrappers ignoring the configured application error renderer; preserve API JSON precedence and add packed configured/default rendering regressions.

Fix packaged membership middleware and default service ignoring the configured application lookup. Use the canonical membership context while preserving explicit service injection and request isolation. Add mandatory packed external-app coverage for concurrent users, replacement configuration and propagated lookup failures.

## 2.2.40

Fix shared DNS fixture state in packaged outbound consumers. safeFetch and GitHub OAuth now use the canonical safeUrl resolver while retaining DNS pinning, private-address validation and request deadlines. Add mandatory packed external-app regressions for resolver replacement and private-target refusal; document controlled-provider qualification limits.

## 2.2.39

Fix published HTTP metrics registry identity: share root/subpath Prometheus state and preserve registry, class and bucket exports. Keep generated middleware/exporter observations consistent and extend installed Postgres/SQLite/MySQL HTTP regressions; no app bridge, schema change or collector-policy change.

## 2.2.38

Qualify packed OIDC and SAML callbacks across Postgres, SQLite and MySQL. Fix explicitly non-migrating local bootstrap provisioning, dialect-safe transactional SAML replay, verified bearer ACS recipient binding, and independent SAML Response Destination validation through a maintained parser. Fix owned listener/client address mismatches with typed generated native options and optional CLI HOST, retaining default production binding. Preserve existing generated auth, production guards, compiler/runtime assertions and coverage gates; live provider and deployment qualification remain separate.

## 2.2.37

Fix MySQL repository entity-returning mutations with transaction-pinned readback, persisted keys/defaults, honest null and deletion outcomes, complete model event payloads and injected connection ownership. Preserve native Postgres/SQLite RETURNING and conditional affected-row metadata. Close owned generated OpenAPI and failed-job command applications on success and failure before exit; retain both command and cleanup errors. Add mandatory packaged MySQL production column-tenancy CLI and HTTP auth/SCIM acceptance with an owned DML-only account, unchanged route/spec/SDK contracts, native ORM regressions and cleanup tests. Records dogfood issues #232 and #233 without application SQL workarounds.

## 2.2.36

Add a mandatory installed-package SQLite column-tenancy CLI/OpenAPI/HTTP profile, including cookie/token/JWT/Basic and repeated SCIM isolation, while preserving existing Postgres security, route inventories, compiler combinations and Docker gates. Reconcile observability/rotation trackers against shipped capabilities and remaining operational qualification.

Fix declared default exports missing from nine published core subpaths. Preserve defaults in generated non-shared entries and alias the shared BaseRepository default to its canonical root constructor, retaining named exports and singleton/class identity. Extend declaration/runtime verification with value-default and type-only-default regressions; compile all nine imports across the existing 18 generated compiler combinations and execute them in every installed candidate app. Records the published 2.2.35 reproduction from Q01 dogfooding; no shop adapter or node_modules patch.

## 2.2.35

Retire checked-in HiroApp applications after preserving security, CLI/OpenAPI/HTTP, source, migration and Docker acceptance in generated candidate-package fixtures. Keep all 23 security cases, 40 runtime operations, 22 API/protocol operations, three-engine migration cases and 18 compiler combinations. Make the private root CLI fixture-only, isolate post-commit HTTP databases, and validate the generated production image with restricted runtime credentials, Redis recovery and graceful shutdown. Remove obsolete app regeneration/selectors and update contributor, generator and deployment documentation; retain compatible example preset IDs and explicit application-owned deployment boundaries. Regenerate the sample SDK from the API-only snapshot and verify it against the installed candidate package. Core coverage retains 136 enforced files at 100%; remove only the two deleted private-entrypoint exemptions (272 remaining).

## 2.2.34

Complete opt-in persisted account-state adoption: atomic SCIM suspension/reactivation and credential revocation, serialized generated password/SSO issuance, version-bound session/MFA/confirmation proofs, safe optional credential-table handling and malformed-cookie rejection. Includes explicit schema migration and upgrade instructions; installing packages alone does not rewrite existing apps.

Database-cookie stores persist and compare optional session epochs, reject inactive/invalid creation state and project the current epoch for sensitive-write fencing. Legacy stores without epoch metadata retain timestamp-watermark behavior. Cookie-session schemas must explicitly opt into the additive session column before deploying epoch-aware writers.

## 2.2.33

Fix shared tenant lookups in generated SQLite column-tenancy apps through typed repositories. Generated SCIM rejects unsupported status/profile mutations before writing and runs mutations in explicit transactions, including immediate observer rollback. Add actual SQLite and restricted Postgres HTTP regressions; full account deactivation remains unsupported and explicit.

## 2.2.32

Generated JSON and HTML email verification now atomically consumes the one-time link with the account update and immediate observers, including SQLite/non-RLS apps. Failed verification remains retryable. Adds actual signed HTTP rollback, purpose/expiry/admission, concurrency and replay regressions while preserving existing response contracts.

## 2.2.31

Preserve JWT issuance precision across millisecond revocation cutoffs without changing expiration. Generated MFA setup rejects stale concurrent state changes and atomically commits credential revocation in SQLite/non-RLS as well as Postgres RLS. Adds real HTTP initial/replacement races, revocation rollback and withheld-success recovery regressions; intentional fresh replacement remains supported.

## 2.2.30

Basic authentication resolution is reused only within the same Request and unchanged credentials, preventing middleware/controller lookups from consuming MFA recovery proofs twice. Adds real HTTP replay/concurrency and credential/guard invalidation regressions.

## 2.2.29

MFA recovery-code persistence atomically claims the validated snapshot and rejects stale requests before credential issuance. Basic authentication fails closed and consumes under the verified RLS identifier scope. Adds native SQLite/Postgres/MySQL concurrency and restricted-role regressions.

## 2.2.28

Generated JSON and HTML password resets validate input before consuming signed links and atomically commit token consumption, password updates and credential revocation. Adds real generated-app failure, retry, replay and cookie/token/JWT revocation regressions.

## 2.2.27

Storage distinguishes missing objects from filesystem, authorization, missing-bucket and transport failures; S3 reads use a single native GET. Adds native Bun protocol regressions and documents failure/reconciliation contracts.

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
