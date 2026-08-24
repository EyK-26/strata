# @getstrata/core changelog

## 0.5.59

Sibling HTMX apps can consume published packages without WorkHub-only glue.

- Emit `@getstrata/core/facades` types at `dist/core/facades/index.d.ts` (CI checks every `exports.*.types` path after build).
- Session and CSRF cookie names are configurable (`SESSION_COOKIE_NAME`, `CSRF_COOKIE_NAME`). Defaults remain `workhub_session` and `workhub_csrf` for WorkHub.
- Split `CORE_ABILITY_CHECKER_TOKEN` and `CORE_AUTH_USER_DIRECTORY_TOKEN` from `CORE_TOKEN_SERVICE_TOKEN`. HttpKernel prefers the ability-checker token; HMAC `SessionGuard` / layout data prefer the user directory. A compatibility shim uses `CORE_TOKEN_SERVICE_TOKEN` only when the bound value matches the requested type.
- `configureWebLayoutData` lets apps choose `currentUser` vs `authUser`, a custom user loader, and extra template fields. WorkHub still gets `{ authUser, csrfToken, flash }`.
- `redirectResponse`, `notFoundHtmlResponse`, `textResponse`, and `xmlResponse` join `htmlResponse` / `isHtmxRequest` on `@getstrata/core/view`.
- `LOGIN_RATE_LIMIT_WINDOW_MS` is a deprecated alias for `LOGIN_RATE_LIMIT_WINDOW_SECONDS`.

HMAC `SessionGuard` is unchanged for WorkHub API/token apps. Sibling HTMX apps should use `@getstrata/bootstrap` `CookieSessionStore` + `createCookieSessionAuthManager`.
