# Building your own app

HiroApp is the example. Your app should live outside this repo (or in `apps/` only if you are this team). Use published packages.

## Scaffold

```bash
bunx @getstrata/starter my-app
cd my-app
cp .env.example .env
```

The starter is a JSON API with `TENANCY_DRIVER=none` (no `tenant` table). Add cookie sessions when you add HTML.

## Three frontend shapes

Set `FRONTEND_MODE`:

1. **`api`.** JSON routes only. Clients send Bearer or Basic. No CSRF.
2. **`server-htmx`.** Eta HTML + HTMX. Cookie session + CSRF. HiroApp is this.
3. **`spa-react`.** JSON API plus a SPA. Prefer opaque tokens or JWT for the SPA, or a cookie if the SPA is same-site and you keep CSRF.

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
