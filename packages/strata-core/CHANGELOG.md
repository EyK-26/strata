# @getstrata/core changelog

## 0.7.2

- `withJsonErrorHandling` always maps thrown errors to JSON. `requestPrefersJson` treats `/api/` as JSON even when `Accept` is HTML, so hybrid staff HTML cannot remap JSON API errors.

## 0.7.1

- `readSpaPrefix` / `normalizeSpaPrefix` own `SPA_PREFIX` (default `/app`). Apps set the env value. They do not copy a second static-file server.
- The log mail driver records `htmlBytes` instead of dumping the HTML document onto stdout.

## 0.7.0

- `FRONTEND_MODE=hybrid` turns on staff HTML and the candidate SPA together. Views are on for `server-htmx` and `hybrid`. The SPA is on for `spa-react` and `hybrid`.
- `parseFrontendMode`, `FRONTEND_MODES`, and `FRONTEND_MODE_PATTERN` are the allowed-value list. Apps should reuse that pattern in env schemas.
- Named database connections: `registerNamedConnection`, `runOnNamedConnection`, SQLite (`bun:sqlite`), and MySQL (`mysql2`). `runWithSqlDialect` keeps the dialect across `await` via AsyncLocalStorage.
- New subpaths: `database/namedConnections`, `database/sqliteConnection`, `database/mysqlConnection`, `database/connectionContext`.
- OpenAPI treats `POST /api/apply/login` as unauthenticated.

## 0.6.0

- **Breaking:** cookie session signatures use HMAC-SHA256. Existing HMAC cookies signed with the previous digest will not verify. Rotate `SESSION_SECRET` or sign users in again.
- **Breaking:** default `MEMBER_ABILITIES` are profile and token scopes (`profile:read`, `auth:tokens:*`), not org/project/task. Apps replace the catalog with `configureAbilityCatalog`. HiroApp maps admin / recruiter / candidate.
- Named auth guards: opaque Bearer tokens, JWT HS256, HTTP Basic, and cookie sessions. `AuthManager` picks a guard from the `Authorization` scheme. CSRF is skipped for Bearer and Basic.
- OpenAPI treats HiroApp login, JWT mint (`POST /api/auth/token`), and public careers as unauthenticated. Partner ping and audit export require credentials.
- SQL dialect helpers (`pgsql`, `mysql`, `sqlite`) for placeholders, quoting, `ILIKE`/`LIKE`, `RETURNING`, and `NULLS LAST`. Full-text `tsMatch` stays Postgres-only and throws on other engines.
- HiroApp is the only in-repo example product. The leftover `src/db` schema is a test fixture, not a second app.
- New subpaths: `auth/jwt`, `auth/jwtGuard`, `auth/basicAuthGuard`, `auth/tokenAbilityChecker`, `database/dialect`, `http/statelessAuth`.

## 0.5.101

- Tenant middleware falls back with explicit branches when a member, admin, or guest tenant lookup misses, so the request still scopes to the default tenant.

## 0.5.100

HiroApp dogfood of 0.5.99: eager `with()` / nested `load("a.b")` missed related rows when a Postgres int4 PK arrived as a JS `number` and an int8 FK as a `bigint`. Map matching used `===`.

- Relation indexers and eager attach compare keys with `relationMatchKey` (`1`, `1n`, `"1"` match).
- Sequential `load("position")` / `application.position()` already used SQL `get()` and were unaffected.
- `registerModelRepository(User, users)` already names `User` and `$morphClass`. Do not also call `registerModelClass("User", User)`. `registerModelClass` is only for an alias that is neither `constructor.name` nor `$morphClass`.

Still non-conforming (honest): Bun cannot infer `morphTo()` method names. `hashed` cast is a no-op. `Factory.has()` without a bound model still needs an explicit FK.

## 0.5.99

HiroApp dogfood of 0.5.98 found lookalike APIs. This release matches the previous PHP framework call shape and SQL, not just export names.

- Relation queries are thenable: `await user.applications()` delegates to `get()`.
- `Model.with()` / `where()` / `whereHas()` return a `ModelQuery` that hydrates models and chains into `where` / `find` / `findOrFail` / `first` / `get`. `first()` / `find()` use `LIMIT` / PK lookup.
- `belongsTo.where()` threads constraints into `whereHas` EXISTS (HiroApp application search).
- `{ ilike }` uses the value as-is (the previous PHP framework). Pass `%term%` yourself; the operator no longer wraps extra `%`.
- Morph type defaults to `$morphClass` / class name, not `table.name`. Override with `$morphClass = "App\\Models\\User"` or the last `morphMany` argument. `morphTo()` no longer silently defaults to `imageable_*`.
- `primaryKey()` defaults to the table PK (`id`).
- Nested `load("a.b")` / `with("a.b")` skip already-loaded heads and batch the next level.
- `count()` is `COUNT(*)` (relations and `RepositoryQuery`).
- `belongsToMany` eager-loads in two queries; `toggle()` and `withPivotValues()` exist. `hasMany.save($model)` sets the FK and saves.
- Factory `for(parent)` infers `user_id` from a Model parent. Bound `model` uses `Model.create()` so observers fire.
- `JsonResource.collection().toResponse()` wraps once: `{ data: [...] }`.
- Observers: `saving` / `saved` / `retrieved`. Integer casts: `integer` / `int`.
- `hasMany("Application")` / `() => Application` / `registerModelClass()` for ESM cycles.

Still non-conforming (honest): Bun cannot infer `morphTo()` method names (`debug_backtrace` equivalent is empty). `hashed` cast is a no-op (bcrypt is async). `Factory.has()` without a model class still needs an explicit FK.

## 0.5.98

- Eloquent-shaped relations: `this.hasMany(Related)` returns a relation query (`get`/`where`/`create`/`attach`). `load()` / `loaded()` and `Model.with()` replace PHP `__get`. `whereHas`/`has`/`doesntHave`, morph* methods, and nested `with("a.b")` are supported.
- Model `$hidden`/`$visible`/`$appends`, `toArray()`/`toJSON()`, `makeHidden`/`makeVisible`/`append`, and `observe()`.
- `Model.where()`, `firstOrNew()`, `firstOrCreate()`, and `updateOrCreate()`.
- Factory `count`/`state`/`sequence`/`for`/`has`/`recycle` plus `afterMaking`/`afterCreating`.
- `JsonResource` (`wrap`, `whenLoaded`, `additional`, `collection`).
- the previous PHP framework aliases: container `make`/`instance`, EventBus `on`/`emit`, query `whereNull`/`whereIn`/`whereExists`.
- Parity audit reports design score separately. Horizon/Nova/CLI stay Bun-native stand-ins.

## 0.5.97

- `mapDatabaseError()` recognizes HTTP errors by `status` + `message`, not only `instanceof HttpError`. Subpath builds duplicate the class, so a thrown `ForbiddenError` was remapped to `400 Bad Request`.

## 0.5.92

- Re-export `resolveMembershipLookup` and `runWithMembershipContext` from the public barrel. Shared subpath shims re-export that barrel, so published `@getstrata/bootstrap` can import `@getstrata/core/auth/membershipContext` without a missing-export boot failure.

## 0.5.91

- `Schedule.command()` accepts any expression `Bun.cron.parse` understands. `dueTasks()` uses the next fire time in the current minute instead of a `*/N` whitelist.
- `Factory.create()` persists `make()` through subclass `persist()` and strips a placeholder `id` of `0`. No states, sequences, or relationships.

## 0.5.90

- **Breaking identity defaults:** `appKeyPrefix()` is `strata` and `appDisplayName()` is `Strata` when `APP_KEY_PREFIX` / `APP_NAME` are unset (were `strata` / `the previous in-repo app`). the previous in-repo app pins those env vars.
- `Schedule.command()` rejects cron strings other than `* * * * *` and `*/N * * * *` instead of silently never running them.
- OpenAPI marks `GET /users/me/*` as bearer-authenticated.
- OpenAPI `/users/me/current-organization` summaries no longer say team invitations.

## 0.5.89

- **Breaking:** removed `@getstrata/core/jobs/dispatchWebhookJob`. Import `DispatchWebhookJob` from the app webhook module (`src/modules/webhook/dispatchWebhookJob.ts`).

## 0.5.88

- Exported cookie name constants (`SESSION_COOKIE`, `CSRF_COOKIE`, `FLASH_COOKIE`, `INTENDED_URL_COOKIE`, `PASSWORD_CONFIRM_COOKIE`) are `appCookieName(...)` so they match the default prefix instead of a hardcoded `strata_` string.
- `@getstrata/core/jobs/dispatchWebhookJob` is a deprecated compatibility re-export of the the previous in-repo app webhook job.

## 0.5.87

- `AuthUserDirectory.hasActiveBrowserSession?(userId, issuedAt)` is optional. `SessionGuard` calls it after `session_valid_after` and rejects the HMAC cookie when it returns false so the previous in-repo app can revoke a single browser session by deleting the `sessions` row.

## 0.5.86

- `createSessionCookieDetails()` returns the HMAC session header plus `issuedAt` / `ttlSeconds` so apps can persist team invitations browser-session rows without changing the cookie format.

## 0.5.85

- `applicationRegistry` prefers the latest `Symbol.for("@getstrata/applicationContext")` on `globalThis` so a stale module-local context cannot hide the bootstrapped app after `build:framework`.

## 0.5.84

- `eventBus` is a `Symbol.for("@getstrata/eventBus")` process singleton so model writes from a built `@getstrata/core/database/baseRepository` bundle reach app listeners that imported a different copy of `@getstrata/core/events` (GitHub Actions `build:framework` before tests).

## 0.5.83

- `MEMBER_ABILITIES` includes `auth:tokens:delete` so team invitations-style personal access token revoke works for members (`DELETE /auth/tokens/:id`). HTML `/account/tokens/:id/revoke` was already authenticated-only.
- `buildOtpauthUrl()` defaults the issuer through `appDisplayName()` (`APP_NAME`).

## 0.5.82

- `MEMBER_ABILITIES` includes `organizations:create` so team invitations-style extra teams work for members (HTML `POST /organizations` and JSON `POST /organizations`). `OrganizationPolicy.create` already allowed any authenticated user.

## 0.5.81

- `@getstrata/core/auth/intendedUrlCookie` (`createIntendedUrlCookie`, `readIntendedUrl`, `clearIntendedUrlCookie`, `createIntendedUrlCookieFromRequest`). HTML auth intended URL after HTML email verification: register with `redirect=` and the previous PHP framework `verified` HTML redirects stash `${APP_KEY_PREFIX}_intended` (`INTENDED_URL_COOKIE_NAME`, default `strata_intended`; TTL `INTENDED_URL_TTL_SECONDS`, default 86400s). `GET /verify-email` honors and clears it.

## 0.5.80

- `appCookieName()` / `appDevSecret()` on `@getstrata/core/runtime/appKeyPrefix`. HMAC session, CSRF, flash, password-confirm, signed-URL, OAuth-state, and token-pepper fallbacks follow `APP_KEY_PREFIX` (the previous in-repo app defaults unchanged).

## 0.5.79

- `readSession()` returns `{ userId, issuedAt }` from the HMAC session cookie. `isSessionInvalidated(issuedAt, session_valid_after)` lets `SessionGuard` reject cookies issued before `AuthUserRecord.session_valid_after` (team invitations logout-other-devices / password change).

## 0.5.78

- OpenAPI treats `POST /auth/two-factor-challenge` as a public operation (no bearer), including when routes are registered under `API_PREFIX`.

## 0.5.77

- `@getstrata/core/security/recoveryCodes` (`generateRecoveryCodes`, `hashRecoveryCode`, `recoveryCodeMatches`). HTML auth-style one-time MFA backup codes (`abcd-efgh`).

## 0.5.76

- `createSessionCookie(userId, { remember })` issues a longer HMAC session (default 30 days, `SESSION_REMEMBER_TTL_SECONDS`). Remember cookies embed the TTL in the signed payload so they stay valid after the default 7-day session lifetime. `SESSION_TTL_SECONDS` overrides the short session.

## 0.5.75

- the previous PHP framework `password.confirm`: `@getstrata/core/auth/passwordConfirmCookie` (`createPasswordConfirmCookie`, `hasFreshPasswordConfirmation`, `clearPasswordConfirmCookie`) and `createRequirePasswordConfirmMiddleware()` (HTML 302 `/confirm-password`, JSON 423). Cookie name `PASSWORD_CONFIRM_COOKIE_NAME` (default `strata_password_confirmed`), TTL `PASSWORD_CONFIRM_TIMEOUT` (default 10800s).

## 0.5.74

- `AuthUser.emailVerifiedAt` and `@getstrata/core/auth/emailVerification` (`isEmailVerificationRequired`, `hasVerifiedEmail`). `null` means unverified; missing is treated as verified (GuestGuard / legacy).
- `createRequireVerifiedMiddleware()` is the previous PHP framework `verified` (HTML 302 `/email/verify`, JSON 403).

## 0.5.73

- OpenAPI treats `POST /auth/email/verification-notification` as a public operation (no bearer).

## 0.5.72

- OpenAPI treats `POST /auth/forgot-password` and `POST /auth/reset-password` as public operations (no bearer).

## 0.5.71

- OpenAPI treats `POST /auth/login` and `POST /auth/register` as public (no bearer), including when routes are registered under `API_PREFIX`.
- Route summaries look up `PUBLIC_ROUTE_DESCRIPTIONS` after stripping `API_PREFIX`.

## 0.5.70

- `OAuthProvider.getAuthorizationUrl` / `exchangeCode` accept an optional `redirectUri` so HTMX login can use `/oauth/:provider/callback` while the API keeps `OAUTH_REDIRECT_URI`.

## 0.5.69

- `MembershipLookup.updateMemberRole(organizationId, userId, role)` is required. The uninitialized lookup throws until `configureMembershipLookup()` is called. `MembershipService.updateMemberRole` delegates to the adapter.

## 0.5.68

- Published core no longer imports the previous in-repo app `src/config`. Frontend mode, queue retries, CORS, and upload limits read env (`FRONTEND_MODE`, `QUEUE_*`, `CORS_ALLOWED_ORIGINS`, `MAX_UPLOAD_BYTES`).
- `@getstrata/core/runtime/frontendMode` exports `readFrontendMode` / `isViewsEnabled` / `isSpaEnabled`.

## 0.5.67

- OpenAPI title, server URLs, and generated SDK class name come from `APP_NAME` / `APP_URL` / `API_PREFIX` / `APP_SDK_CLASS` instead of importing the previous in-repo app `src/config/app`.
- `appEnv()`, `appUrl()`, `apiPrefix()`, and `sdkClientClassName()` live on `@getstrata/core/runtime/appKeyPrefix`. SIEM export, HSTS, and `safeFetch` DNS resolve use `appEnv()` instead of the previous in-repo app `appConfig`.

## 0.5.66

- `createValidateSignatureMiddleware()` on `@getstrata/core/http/signedUrl` is the previous PHP framework's `signed` / `ValidateSignature` middleware. Invalid or expired links throw `ForbiddenError`.

## 0.5.65

- Identity helpers on `@getstrata/core/runtime/appKeyPrefix` (`smtpEhloHost`, `siemEventType`, `appUserAgent`, `otelServiceName`, `appDisplayName`, `webhookSignatureHeader`) so sibling apps are not stuck with the previous in-repo app SMTP/SIEM/OTEL/OAuth names.
- SIEM `event_type` and CEF vendor follow `SIEM_EVENT_TYPE` / `APP_NAME` (defaults stay `strata.audit` / `the previous in-repo app`).

## 0.5.64

- `APP_KEY_PREFIX` (default `strata`) namespaces Redis cache, queue, and throttle keys so sibling apps do not share the previous in-repo app's keyspace.
- `DispatchWebhookJob` implementation lives in the the previous in-repo app webhook module. `@getstrata/core/jobs/dispatchWebhookJob` remains a compatibility re-export.

## 0.5.63

- Flash cookies honor `FLASH_COOKIE_NAME` (default `strata_flash`) so sibling apps do not inherit the previous in-repo app's cookie name.

## 0.5.62

the previous PHP framework URL signing, Bun-native markdown mail, and session-auth cleanup.

- `temporarySignedUrl` / `signedUrl` / `hasValidSignature` / `assertValidSignature` on `@getstrata/core/http/signedUrl`. HMAC uses `SIGNED_URL_SECRET` or `SESSION_SECRET`. Paths must be same-origin (`/` only; reject `//` and `://`).
- `markdownToHtml()` uses `Bun.markdown.html()` plus `sanitizeMailHtml` (allowlist). Scripts, `javascript:` links, and unknown tags are stripped.
- `ExportAuditLogsJob` (`@getstrata/core/jobs/exportAuditLogsJob`) wraps SIEM export so the scheduler can dispatch a real job.
- `DispatchWebhookJob` reads `APP_ENV` and `WEBHOOK_SIGNATURE_HEADER` instead of the previous in-repo app `appConfig`.
- `createRequireWebAuthMiddleware` runs the handler inside `runWithAuthUser` so `currentAuthUser()` works on HTMX session routes.
- `generateTotpSecret()` / `buildOtpauthUrl()` on `@getstrata/core/security/totp`.
- `createRequireAbilityMiddleware` rethrows `ForbiddenError` for HTML views so HTMX routes render a styled 403 instead of JSON.

## 0.5.61

HTMX HTML kernel gaps that sibling apps could not work around without weakening CSP or duplicating the framework.

- `createSecurityHeadersMiddleware({ csp | htmlCsp | directives })` and `configureContentSecurityPolicy()` extend the HTMX baseline. Defaults now allow YouTube/Vimeo embeds, `https:` media, `data:`/`https:` images, the HTMX 2.0.4 indicator style hash, and a per-request nonce on `script-src`/`style-src`. API JSON stays `default-src 'none'`. Do not add `'unsafe-inline'` to `script-src`.
- `configureWebErrorView` / `notFoundHtmlResponse()` render styled HTML 404/403/500 (app `errors/*.eta` or kernel chrome with `/assets/app.css`). Production 5xx messages do not leak stacks.
- `EtaViewEngine` passes `Request` into `resolveLayoutData`. `configureWebLayoutData({ loadUser })` receives that request as the second argument. Layout data includes `cspNonce`.
- `securedBindRouteModelByKey` treats a null model as `NotFoundError`. GET ETags are skipped for HTML and composite objects unless `etag: true`.
- Login redirects keep `pathname + search` after a same-origin safe-path check (`/forum?page=2` → `/login?redirect=%2Fforum%3Fpage%3D2`).

## 0.5.60

- `@getstrata/core/database/boundConnection` publishes `getBoundDatabaseConnection` and `resetBoundDatabaseConnection` on the JS entry (not only the types file). Tests can reset the bound pool after `closeDatabase()` without a postinstall patch.
- `bindBunSql` / `createBunSqlPool` on `@getstrata/core/database/bunSql` create a Bun `SQL` pool and register it as the bound connection plus default pool.
- `xmlResponse` accepts `{ contentType }`. `rssResponse` sends `application/rss+xml`.
- Memory throttle buckets are per middleware instance. `resetMemoryThrottleForTests()` clears every instance map so nested HTTP tests do not leak.

## 0.5.59

Sibling HTMX apps can consume published packages without the previous in-repo app-only glue.

- Emit `@getstrata/core/facades` types at `dist/core/facades/index.d.ts` (CI checks every `exports.*.types` path after build).
- Session and CSRF cookie names are configurable (`SESSION_COOKIE_NAME`, `CSRF_COOKIE_NAME`). Defaults remain `strata_session` and `strata_csrf` for the previous in-repo app.
- Split `CORE_ABILITY_CHECKER_TOKEN` and `CORE_AUTH_USER_DIRECTORY_TOKEN` from `CORE_TOKEN_SERVICE_TOKEN`. HttpKernel prefers the ability-checker token; HMAC `SessionGuard` / layout data prefer the user directory. A compatibility shim uses `CORE_TOKEN_SERVICE_TOKEN` only when the bound value matches the requested type.
- `configureWebLayoutData` lets apps choose `currentUser` vs `authUser`, a custom user loader, and extra template fields. the previous in-repo app still gets `{ authUser, csrfToken, flash }`.
- `redirectResponse`, `notFoundHtmlResponse`, `textResponse`, and `xmlResponse` join `htmlResponse` / `isHtmxRequest` on `@getstrata/core/view`.
- `LOGIN_RATE_LIMIT_WINDOW_MS` is a deprecated alias for `LOGIN_RATE_LIMIT_WINDOW_SECONDS`.

HMAC `SessionGuard` is unchanged for the previous in-repo app API/token apps. Sibling HTMX apps should use `@getstrata/bootstrap` `CookieSessionStore` + `createCookieSessionAuthManager`.
