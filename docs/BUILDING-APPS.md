# Building your own app

HiroApp is the example. Your app should live outside this repo (or in `apps/` only if you are this team). Use published packages.

## Scaffold

```bash
bunx @getstrata/starter my-app
cd my-app
cp .env.example .env
```

The starter is a JSON API with `TENANCY_DRIVER=none` (no `tenant` table). Add cookie sessions when you add HTML.

## Frontend shapes

Set `FRONTEND_MODE`. Allowed values live in `@getstrata/core/runtime/frontendMode` (`parseFrontendMode`, `FRONTEND_MODE_PATTERN`). Apps should reuse that pattern in their env schema instead of copying a regex.

1. **`api`.** JSON routes only. Clients send Bearer or Basic. No CSRF.
2. **`server-htmx`.** Eta HTML + HTMX. Cookie session + CSRF.
3. **`spa-react`.** JSON API plus a SPA document under `SPA_PREFIX` (default `/app`). Prefer opaque tokens for the SPA. HiroApp sets `SPA_PREFIX=/apply`.
4. **`hybrid`.** Staff HTML at `/` plus a SPA prefix. Framework SPA routes stay under `SPA_PREFIX` (`/app`, `/app/`, `/app/*` by default) and do not redirect `/`. Apps call `mergeSpaRoutes` with `distDirectory` and `wrap`. Do not copy a second static-file server.

`.eta` files are HTML plus Eta tags (`<% %>`, `<%= %>`, `<%~ include() %>`). Class shorthand such as `section.section` fails at render.

## Cookie HTML apps

```typescript
import { createCookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { CORE_AUTH_TOKEN } from "@getstrata/core/contracts/serviceTokens";

const auth = createCookieSessionAuthManager({
  secret: process.env.SESSION_SECRET,
  cookieName: "myapp_session",
  loadSessionUser, // your SELECT from sessions + users
  mapUser: (user) => ({ id: user.id, role: user.is_admin ? "admin" : "member" }),
});
container.set(CORE_AUTH_TOKEN, auth);
```

Pass `loadSessionUser` whenever the default `SELECT u.*` does not match your `users` table. HiroApp maps `role_id` and `email_verified_at` in `apps/hiroapp/src/bootstrap/providers/auth.ts`.

Use `signIn` / `signOut` (or the redirect helpers). Do not mint cookies in controllers.

`wrapWebGuest` sends already-signed-in people to `/` (pass a path if your home is not `/`). `wrapWebLogin` already includes throttle. Do not wrap it with `wrapWeb` again.

## Adding API tokens, JWT, or Basic

```typescript
import { DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";

auth.registerGuard("api", new DatabaseTokenGuard(container));
auth.registerGuard("jwt", new JwtGuard());
auth.registerGuard("basic", new BasicAuthGuard(container));
```

Bind an `AuthUserDirectory` that can `resolveUserFromToken`, `findByEmail`, and `verifyCredentials`. See [AUTH.md](./AUTH.md) and HiroApp `authDirectory.ts`.

## HTTP kernel

`createHttpKernel(dependencies)` groups middleware (`web`, `api`, `authenticated`). HiroApp adds CSRF, tenant, and verified-email around those groups in `apps/hiroapp/src/http/wrap.ts`. Copy that file more than you copy HiroApp domain modules.

Prefer `buildModuleRoutes` / `buildWebModuleRoutes` for a new app. `@getstrata/bootstrap/createRoutes` still assembles leftover fixture HTTP for framework tests. It is not your starter.

## Views and errors

Configure layout data (`currentUser`, `csrfToken`, `flash`) and error templates (`errors/not-found.eta`, `errors/forbidden.eta`, `errors/error.eta`). Production 5xx must not leak stacks.

## Secrets

Call `assertProductionSecrets()` from your `createApp` / `serve` path. It is feature-gated: a cookie HTML app with `SESSION_SECRET` and `AUTH_DEV_HEADERS=false` does not need API tokens if those features are off. HiroApp calls it at boot.

## Identity env

| Variable | Default when unset |
|----------|--------------------|
| `APP_KEY_PREFIX` | `strata` |
| `APP_NAME` | `Strata` |
| `API_PREFIX` | `/api/v1` |
| `APP_SDK_CLASS` | `${APP_NAME}Client` |

HiroApp pins `hiroapp` / `HiroApp` / `/api`.

## Next

- [AUTH.md](./AUTH.md)
- [DATABASE.md](./DATABASE.md)
- [PACKAGING.md](./PACKAGING.md)
