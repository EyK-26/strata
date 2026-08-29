# @getstrata/core changelog

## 0.5.62

Laravel URL signing, Bun-native markdown mail, and session-auth cleanup.

- `temporarySignedUrl` / `signedUrl` / `hasValidSignature` / `assertValidSignature` on `@getstrata/core/http/signedUrl`. HMAC uses `SIGNED_URL_SECRET` or `SESSION_SECRET`. Paths must be same-origin (`/` only; reject `//` and `://`).
- `markdownToHtml()` uses `Bun.markdown.html()` plus `sanitizeMailHtml` (allowlist). Scripts, `javascript:` links, and unknown tags are stripped.
- `ExportAuditLogsJob` (`@getstrata/core/jobs/exportAuditLogsJob`) wraps SIEM export so the scheduler can dispatch a real job.
- `DispatchWebhookJob` reads `APP_ENV` and `WEBHOOK_SIGNATURE_HEADER` instead of WorkHub `appConfig`.
- `createRequireWebAuthMiddleware` runs the handler inside `runWithAuthUser` so `currentAuthUser()` works on HTMX session routes.

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
