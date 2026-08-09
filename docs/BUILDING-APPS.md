# Building your own app

HiroApp is the in-repo generated example. For a product app, use `bunx create-strata` and the published packages.

## Scaffold

```bash
bunx create-strata my-app
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

`strata` installs into the app rather than globally, so use the `bun run` scripts above, or `bunx strata <command>` from inside the app directory.

The CLI is interactive in a terminal. Move with ↑/↓ and Enter, or type a number. Toggle extras that apply to your stack (MFA, email verification, SCIM, metrics) with Space. Header auth does not offer MFA or SCIM. `--no-metrics` skips the metrics extra and does not write `GET /metrics`. For CI, pass `--yes` and layer flags (`--frontend`, `--database`, `--auth`, `--tenancy`, `--cache`, `--queue`, `--mail`). Docker Compose is optional: `--docker`, `--no-docker`, or `--docker-services=postgres,redis`. `--docker` with Postgres or MySQL also writes Adminer at http://localhost:8080.

Layer flags: [STARTER.md](./STARTER.md). The three in-repo examples are generated from that script (`bun run generate:example-apps`). Do not treat HiroApp as the source of the wizard.

## Frontend shapes

Set `FRONTEND_MODE`. Allowed values live in `@getstrata/core/runtime/frontendMode` (`parseFrontendMode`, `FRONTEND_MODE_PATTERN`). Apps should reuse that pattern in their env schema instead of copying a regex.

1. **`api`.** JSON routes only. Clients send Bearer or Basic. No CSRF.
2. **`server-htmx`.** Eta HTML + HTMX. Cookie session + CSRF.
3. **`spa-react`.** JSON API plus a SPA document under `SPA_PREFIX` (default `/app`). Prefer opaque tokens for the SPA.
4. **`hybrid`.** HTML at `/` plus a SPA prefix. Framework SPA routes stay under `SPA_PREFIX` (`/app`, `/app/`, `/app/*` by default) and do not redirect `/`. Apps call `mergeSpaRoutes` with `distDirectory` and `wrap`. Do not copy a second static-file server.

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

Pass `loadSessionUser` whenever the default `SELECT u.*` does not match your `users` table. Generated cookie apps map `is_admin` in `src/bootstrap/providers/auth.ts`.

Use `signIn` / `signOut` (or the redirect helpers). Do not mint cookies in controllers.

`wrapWebGuest` sends already-signed-in people to `/` (pass a path if your home is not `/`). `wrapWebLogin` already includes throttle. Do not wrap it with `wrapWeb` again.

Cookie apps from `create-strata` include restyleable welcome, login, register, and password reset screens in `views/` plus `public/assets/site.css`. Add more routes in `src/modules`.

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

`createHttpKernel(dependencies)` groups middleware (`web`, `api`, `authenticated`). Generated apps use `buildModuleRoutes` / `buildWebModuleRoutes`. `@getstrata/bootstrap/createRoutes` still assembles leftover fixture HTTP for framework tests. It is not your starter.

## Views and errors

Configure layout data (`currentUser`, `csrfToken`, `flash`) and error templates (`errors/not-found.eta`, `errors/forbidden.eta`, `errors/error.eta`). Production 5xx must not leak stacks.

## Secrets

Call `assertProductionSecrets()` from your `createApp` / `serve` path when `isProductionEnv()` is true. Staging counts as production for this check. It is feature-gated: a cookie HTML app with `SESSION_SECRET` and `AUTH_DEV_HEADERS=false` does not need API tokens if those features are off. Generated apps call it at boot.

## Identity env

| Variable | Default when unset |
|----------|--------------------|
| `APP_KEY_PREFIX` | `strata` |
| `APP_NAME` | `Strata` |
| `API_PREFIX` | `/api/v1` |
| `APP_SDK_CLASS` | `${APP_NAME}Client` |

Generated HiroApp pins `APP_KEY_PREFIX=hiroapp`, `APP_NAME=hiroapp`, and `API_PREFIX=/api`. The HTML session cookie is still `strata_session` unless you change `cookieName`.

## Next

- [AUTH.md](./AUTH.md)
- [DATABASE.md](./DATABASE.md)
- [PACKAGING.md](./PACKAGING.md)
