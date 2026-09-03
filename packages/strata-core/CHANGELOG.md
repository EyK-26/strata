# @getstrata/core changelog

## 0.5.98

- Eloquent-shaped relations: `this.hasMany(Related)` returns a relation query (`get`/`where`/`create`/`attach`). `load()` / `loaded()` and `Model.with()` replace PHP `__get`. `whereHas`/`has`/`doesntHave`, morph* methods, and nested `with("a.b")` are supported.
- Model `$hidden`/`$visible`/`$appends`, `toArray()`/`toJSON()`, `makeHidden`/`makeVisible`/`append`, and `observe()`.
- `Model.where()`, `firstOrNew()`, `firstOrCreate()`, and `updateOrCreate()`.
- Factory `count`/`state`/`sequence`/`for`/`has`/`recycle` plus `afterMaking`/`afterCreating`.
- `JsonResource` (`wrap`, `whenLoaded`, `additional`, `collection`).
- Laravel aliases: container `make`/`instance`, EventBus `on`/`emit`, query `whereNull`/`whereIn`/`whereExists`.
- Parity audit reports design score separately. Horizon/Nova/CLI stay Bun-native stand-ins.

## 0.5.97

- `mapDatabaseError()` recognizes HTTP errors by `status` + `message`, not only `instanceof HttpError`. Subpath builds duplicate the class, so a thrown `ForbiddenError` was remapped to `400 Bad Request`.

## 0.5.92

- Re-export `resolveMembershipLookup` and `runWithMembershipContext` from the public barrel. Shared subpath shims re-export that barrel, so published `@getstrata/bootstrap` can import `@getstrata/core/auth/membershipContext` without a missing-export boot failure.

## 0.5.91

- `Schedule.command()` accepts any expression `Bun.cron.parse` understands. `dueTasks()` uses the next fire time in the current minute instead of a `*/N` whitelist.
- `Factory.create()` persists `make()` through subclass `persist()` and strips a placeholder `id` of `0`. No states, sequences, or relationships.

## 0.5.90

- **Breaking identity defaults:** `appKeyPrefix()` is `strata` and `appDisplayName()` is `Strata` when `APP_KEY_PREFIX` / `APP_NAME` are unset (were `workhub` / `WorkHub`). WorkHub pins those env vars.
- `Schedule.command()` rejects cron strings other than `* * * * *` and `*/N * * * *` instead of silently never running them.
- OpenAPI marks `GET /users/me/*` as bearer-authenticated.
- OpenAPI `/users/me/current-organization` summaries no longer say Jetstream.

## 0.5.89

- **Breaking:** removed `@getstrata/core/jobs/dispatchWebhookJob`. Import `DispatchWebhookJob` from the app webhook module (`src/modules/webhook/dispatchWebhookJob.ts`).

## 0.5.88

- Exported cookie name constants (`SESSION_COOKIE`, `CSRF_COOKIE`, `FLASH_COOKIE`, `INTENDED_URL_COOKIE`, `PASSWORD_CONFIRM_COOKIE`) are `appCookieName(...)` so they match the default prefix instead of a hardcoded `workhub_` string.
- `@getstrata/core/jobs/dispatchWebhookJob` is a deprecated compatibility re-export of the WorkHub webhook job.

## 0.5.87

- `AuthUserDirectory.hasActiveBrowserSession?(userId, issuedAt)` is optional. `SessionGuard` calls it after `session_valid_after` and rejects the HMAC cookie when it returns false so WorkHub can revoke a single browser session by deleting the `sessions` row.

## 0.5.86

- `createSessionCookieDetails()` returns the HMAC session header plus `issuedAt` / `ttlSeconds` so apps can persist Jetstream browser-session rows without changing the cookie format.

## 0.5.85

- `applicationRegistry` prefers the latest `Symbol.for("@getstrata/applicationContext")` on `globalThis` so a stale module-local context cannot hide the bootstrapped app after `build:framework`.

## 0.5.84

- `eventBus` is a `Symbol.for("@getstrata/eventBus")` process singleton so model writes from a built `@getstrata/core/database/baseRepository` bundle reach app listeners that imported a different copy of `@getstrata/core/events` (GitHub Actions `build:framework` before tests).

## 0.5.83

- `MEMBER_ABILITIES` includes `auth:tokens:delete` so Jetstream-style personal access token revoke works for members (`DELETE /auth/tokens/:id`). HTML `/account/tokens/:id/revoke` was already authenticated-only.
- `buildOtpauthUrl()` defaults the issuer through `appDisplayName()` (`APP_NAME`).

## 0.5.82

- `MEMBER_ABILITIES` includes `organizations:create` so Jetstream-style extra teams work for members (HTML `POST /organizations` and JSON `POST /organizations`). `OrganizationPolicy.create` already allowed any authenticated user.

## 0.5.81

- `@getstrata/core/auth/intendedUrlCookie` (`createIntendedUrlCookie`, `readIntendedUrl`, `clearIntendedUrlCookie`, `createIntendedUrlCookieFromRequest`). Fortify intended URL after HTML email verification: register with `redirect=` and Laravel `verified` HTML redirects stash `${APP_KEY_PREFIX}_intended` (`INTENDED_URL_COOKIE_NAME`, default `workhub_intended`; TTL `INTENDED_URL_TTL_SECONDS`, default 86400s). `GET /verify-email` honors and clears it.

## 0.5.80

- `appCookieName()` / `appDevSecret()` on `@getstrata/core/runtime/appKeyPrefix`. HMAC session, CSRF, flash, password-confirm, signed-URL, OAuth-state, and token-pepper fallbacks follow `APP_KEY_PREFIX` (WorkHub defaults unchanged).

## 0.5.79

- `readSession()` returns `{ userId, issuedAt }` from the HMAC session cookie. `isSessionInvalidated(issuedAt, session_valid_after)` lets `SessionGuard` reject cookies issued before `AuthUserRecord.session_valid_after` (Jetstream logout-other-devices / password change).

## 0.5.78

- OpenAPI treats `POST /auth/two-factor-challenge` as a public operation (no bearer), including when routes are registered under `API_PREFIX`.

## 0.5.77

- `@getstrata/core/security/recoveryCodes` (`generateRecoveryCodes`, `hashRecoveryCode`, `recoveryCodeMatches`). Fortify-style one-time MFA backup codes (`abcd-efgh`).

## 0.5.76

- `createSessionCookie(userId, { remember })` issues a longer HMAC session (default 30 days, `SESSION_REMEMBER_TTL_SECONDS`). Remember cookies embed the TTL in the signed payload so they stay valid after the default 7-day session lifetime. `SESSION_TTL_SECONDS` overrides the short session.

## 0.5.75

- Laravel `password.confirm`: `@getstrata/core/auth/passwordConfirmCookie` (`createPasswordConfirmCookie`, `hasFreshPasswordConfirmation`, `clearPasswordConfirmCookie`) and `createRequirePasswordConfirmMiddleware()` (HTML 302 `/confirm-password`, JSON 423). Cookie name `PASSWORD_CONFIRM_COOKIE_NAME` (default `workhub_password_confirmed`), TTL `PASSWORD_CONFIRM_TIMEOUT` (default 10800s).

## 0.5.74

- `AuthUser.emailVerifiedAt` and `@getstrata/core/auth/emailVerification` (`isEmailVerificationRequired`, `hasVerifiedEmail`). `null` means unverified; missing is treated as verified (GuestGuard / legacy).
- `createRequireVerifiedMiddleware()` is Laravel `verified` (HTML 302 `/email/verify`, JSON 403).

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

- Published core no longer imports WorkHub `src/config`. Frontend mode, queue retries, CORS, and upload limits read env (`FRONTEND_MODE`, `QUEUE_*`, `CORS_ALLOWED_ORIGINS`, `MAX_UPLOAD_BYTES`).
- `@getstrata/core/runtime/frontendMode` exports `readFrontendMode` / `isViewsEnabled` / `isSpaEnabled`.

## 0.5.67

- OpenAPI title, server URLs, and generated SDK class name come from `APP_NAME` / `APP_URL` / `API_PREFIX` / `APP_SDK_CLASS` instead of importing WorkHub `src/config/app`.
- `appEnv()`, `appUrl()`, `apiPrefix()`, and `sdkClientClassName()` live on `@getstrata/core/runtime/appKeyPrefix`. SIEM export, HSTS, and `safeFetch` DNS resolve use `appEnv()` instead of WorkHub `appConfig`.

## 0.5.66

- `createValidateSignatureMiddleware()` on `@getstrata/core/http/signedUrl` is Laravel’s `signed` / `ValidateSignature` middleware. Invalid or expired links throw `ForbiddenError`.

## 0.5.65

- Identity helpers on `@getstrata/core/runtime/appKeyPrefix` (`smtpEhloHost`, `siemEventType`, `appUserAgent`, `otelServiceName`, `appDisplayName`, `webhookSignatureHeader`) so sibling apps are not stuck with WorkHub SMTP/SIEM/OTEL/OAuth names.
- SIEM `event_type` and CEF vendor follow `SIEM_EVENT_TYPE` / `APP_NAME` (defaults stay `workhub.audit` / `WorkHub`).

## 0.5.64

- `APP_KEY_PREFIX` (default `workhub`) namespaces Redis cache, queue, and throttle keys so sibling apps do not share WorkHub’s keyspace.
- `DispatchWebhookJob` implementation lives in the WorkHub webhook module. `@getstrata/core/jobs/dispatchWebhookJob` remains a compatibility re-export.

## 0.5.63

- Flash cookies honor `FLASH_COOKIE_NAME` (default `workhub_flash`) so sibling apps do not inherit WorkHub’s cookie name.

## 0.5.62

Laravel URL signing, Bun-native markdown mail, and session-auth cleanup.

- `temporarySignedUrl` / `signedUrl` / `hasValidSignature` / `assertValidSignature` on `@getstrata/core/http/signedUrl`. HMAC uses `SIGNED_URL_SECRET` or `SESSION_SECRET`. Paths must be same-origin (`/` only; reject `//` and `://`).
- `markdownToHtml()` uses `Bun.markdown.html()` plus `sanitizeMailHtml` (allowlist). Scripts, `javascript:` links, and unknown tags are stripped.
- `ExportAuditLogsJob` (`@getstrata/core/jobs/exportAuditLogsJob`) wraps SIEM export so the scheduler can dispatch a real job.
- `DispatchWebhookJob` reads `APP_ENV` and `WEBHOOK_SIGNATURE_HEADER` instead of WorkHub `appConfig`.
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

Sibling HTMX apps can consume published packages without WorkHub-only glue.

- Emit `@getstrata/core/facades` types at `dist/core/facades/index.d.ts` (CI checks every `exports.*.types` path after build).
- Session and CSRF cookie names are configurable (`SESSION_COOKIE_NAME`, `CSRF_COOKIE_NAME`). Defaults remain `workhub_session` and `workhub_csrf` for WorkHub.
- Split `CORE_ABILITY_CHECKER_TOKEN` and `CORE_AUTH_USER_DIRECTORY_TOKEN` from `CORE_TOKEN_SERVICE_TOKEN`. HttpKernel prefers the ability-checker token; HMAC `SessionGuard` / layout data prefer the user directory. A compatibility shim uses `CORE_TOKEN_SERVICE_TOKEN` only when the bound value matches the requested type.
- `configureWebLayoutData` lets apps choose `currentUser` vs `authUser`, a custom user loader, and extra template fields. WorkHub still gets `{ authUser, csrfToken, flash }`.
- `redirectResponse`, `notFoundHtmlResponse`, `textResponse`, and `xmlResponse` join `htmlResponse` / `isHtmxRequest` on `@getstrata/core/view`.
- `LOGIN_RATE_LIMIT_WINDOW_MS` is a deprecated alias for `LOGIN_RATE_LIMIT_WINDOW_SECONDS`.

HMAC `SessionGuard` is unchanged for WorkHub API/token apps. Sibling HTMX apps should use `@getstrata/bootstrap` `CookieSessionStore` + `createCookieSessionAuthManager`.
