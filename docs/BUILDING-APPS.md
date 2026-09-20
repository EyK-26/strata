# Building your own app

HiroApp (`apps/hiroapp`) is in-repo dogfood for internal end-to-end testing. For a product app, use `bunx create-strata` and the published packages.

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

The CLI is interactive in a terminal. Move with ↑/↓ and Enter, or type a number. Toggle extras that apply to your stack (MFA, email verification, SCIM, metrics, GitHub OAuth, billing, webhooks) with Space. Header auth does not offer MFA, SCIM, or GitHub login. `--no-metrics` skips the metrics extra and does not write `GET /metrics`. For CI, pass `--yes` and layer flags (`--frontend`, `--database`, `--auth`, `--tenancy`, `--cache`, `--queue`, `--mail`). Docker Compose is optional: `--docker`, `--no-docker`, or `--docker-services=postgres,redis`. `--docker` with Postgres or MySQL also writes Adminer at http://localhost:8080.

Layer flags: [STARTER.md](./STARTER.md). The three in-repo apps are generated from that script (`bun run generate:example-apps`). Do not treat HiroApp as the source of the wizard. Only `apps/hiroapp` is CI dogfood.

## Frontend shapes

Set `FRONTEND_MODE`. Allowed values live in `@getstrata/core/runtime/frontendMode` (`parseFrontendMode`, `FRONTEND_MODE_PATTERN`). Apps should reuse that pattern in their env schema instead of copying a regex.

1. **`api`.** JSON routes only. Clients send Bearer or Basic. Guest JSON login (`POST /api/v1/auth/login` and `POST /api/auth/token`) needs `GET /api/v1/auth/csrf` first. That GET returns the same token it Set-Cookies. Send `X-CSRF-Token` plus the CSRF cookie. A missing token is JSON 403. Bearer and Basic skip CSRF only after that guard authenticates.
2. **`server-htmx`.** Eta HTML + HTMX. Cookie session + CSRF.
3. **`spa-react`.** JSON API plus a SPA document under `SPA_PREFIX` (default `/app`). Prefer opaque tokens for the SPA. Cookie JSON after login needs `GET /api/v1/auth/csrf`.
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
auth.registerGuard("jwt", new JwtGuard(container));
auth.registerGuard("basic", new BasicAuthGuard(container));
```

Bind an `AuthUserDirectory` that can `resolveUserFromToken`, `findByEmail`, and `verifyCredentials`. See [AUTH.md](./AUTH.md) and HiroApp `authDirectory.ts`.

## HTTP kernel

`createHttpKernel(dependencies)` groups middleware (`web`, `api`, `authenticated`). Generated apps use `buildModuleRoutes` / `buildWebModuleRoutes`. `@getstrata/bootstrap/createRoutes` still assembles leftover fixture HTTP for framework tests. It is not your starter.

## Module providers and infra defaults

After `ensureModulesLoaded()`, generated apps run each module's `providers` through the same `register` / `boot` phases as `starterProviders`. Module DI (services, policies) therefore works without calling `collectProviders()` (which would swap in the monorepo `coreProviders` auth stack).

Starter apps also call `registerDefaultJobs` and `discoverJobs()` when wiring the queue and `registerInvalidateCacheOnModelWriteListeners` during provider boot so cache tags flush through the default invalidation job. `src/listeners/*.ts` registrars are loaded via `discoverListeners()` in the same boot phase (idempotent listener groups, same pattern as the monorepo `core.listeners` provider). `src/jobs/*.ts` classes with `static jobName` are registered the same way.

Generated apps use **two provider waves**: starter `register`/`boot`, then module `register`/`boot`. That is intentional — do not replace it with `collectProviders()` without re-reading auth order (starter `queue → auth → policy` vs monorepo `coreProviders`). Module `register` runs after starter has already booted (jobs and listeners attached). Prefer `bootstrapApp()` / `createApp()` in app code; calling exported `createAppContext()` without a prior `ensureModulesLoaded()` skips module providers silently.

## Database migrations

Greenfield apps from `create-strata` use **file-based** migrations in `src/db/migrations/` plus `@getstrata/core/database/migrations` (`migrateDatabase`) from `src/db/migrate.ts`. Seed stays in `migrate.ts`. The runner records applied files in **`framework_migrations`**. See [STARTER.md](./STARTER.md#migrations).

`0001_starter_schema` uses `CREATE TABLE IF NOT EXISTS`. Redis/queue apps include **`failed_job`** there (`queue:failed` / `queue:retry` persist into that table). An inline-SQL app that never created `failed_job` will break those commands even if the rest of the schema looks fine.

### Adopting file migrations from a legacy inline migrate.ts

Apps scaffolded before file migrations often loop `db.unsafe(...)` in one file and have **no** `framework_migrations` table.

1. Copy the generated shape: `src/db/migrationRuntime.ts` (`loadMigrationsFromDirectory` + `withMigrationDatabase`) and `src/db/migrations/*.ts` (start with `0001_starter_schema` plus your extra tables).
2. Replace the inline SQL loop with `await migrateDatabase(db, await loadStarterMigrations())`. Keep seed in `migrate.ts`.
3. First `bun run db:migrate` creates `framework_migrations` and applies every file not already recorded. Keep `CREATE TABLE IF NOT EXISTS` (and additive `ALTER`s) so a database that already has the tables does not fail on duplicate DDL.
4. If Redis queue is on, add `failed_job` in that first file if the live schema does not have it.

When history is untrustworthy:

- **Local / empty data:** `strata migrate:fresh` (generated `src/db/fresh.ts` → `freshDatabase`) runs `down` for recorded files, clears `framework_migrations`, then applies all files. It is destructive. Do not use it on production data.
- **Production / keep rows:** keep `IF NOT EXISTS`, run `migrate` once so the runner records the files, then add later changes as **new** numbered files. Do not hand-insert `framework_migrations` rows unless a file must never run (document why). `migrate:status` shows pending vs `up`.

Do not mix the monorepo fixture runner with a product app’s `src/db/migrations/` on the same database.

## File uploads

`parseMultipartUpload` (JSON / single-file API) already enforces `MAX_UPLOAD_BYTES` / `MAX_REQUEST_BODY_BYTES` and `ALLOWED_UPLOAD_MIME_TYPES` via `@getstrata/core/http/uploads`.

`@getstrata/bootstrap/web/forms` `parseFormBody` is for mixed HTMX forms (fields + `File`). It returns **raw** `files[name]: File` and does **not** apply those guards.

```typescript
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { validateUploadFile } from "@getstrata/core/http/parseMultipartUpload";
import { isAllowedMimeType } from "@getstrata/core/http/uploads";

const { fields, files } = await parseFormBody(request);
const image = files.image;
if (image) {
  const upload = await validateUploadFile(image, "image");
  // upload.fileName, mimeType, size, contents
}
```

Use `parseMultipartUpload(request, "file")` when the request is only that one file field. Do not reimplement the MIME list; import `isAllowedMimeType` / `resolveMaxUploadBytes` from `@getstrata/core/http/uploads`. `UPLOAD_ALLOW_UNKNOWN_MIME=true` is required before `application/octet-stream` is accepted.

## Extending the CLI

Generated apps depend on `@getstrata/cli` (lifecycle commands plus whatever `src/cli/register.ts` exports). The starter writes `src/cli/register.ts` with `queue:work`, failed-job commands, `make:*`, `openapi:*`, and `schedule:run`. `queue:work` calls `bootstrapApp({ migrate: false })` / `createApp()` through `@getstrata/cli/queueWorker` so starter and module providers load. Do not copy the monorepo `queue:work` command (`createAppContext()` from `@getstrata/bootstrap/context`, `coreProviders`).

To add more commands, extend that file (`commands` or `registerCommands()`). Scaffold commands write under `process.cwd()` (`src/modules`, `src/db/migrations`, `src/jobs`). `openapi:*` uses `createApp()` routes. `schedule:run` loads `src/bootstrap/schedule.ts` after boot.

## Optional feature flags

The starter wizard covers MFA, email verification, SCIM, metrics, plus optional `--oauth-github`, `--billing`, and `--webhooks` (all off by default). Other integrations (OIDC cookie login, SIEM export, hybrid SPA) stay env-driven or deferred. See [INTEGRATIONS.md](./INTEGRATIONS.md) and [PRODUCTION.md](./PRODUCTION.md). Outbound webhooks use `discoverJobs()`, not a `registerWebhookJobs()` helper (that symbol was never exported).

## Views and errors

Configure layout data (`currentUser`, `csrfToken`, `flash`) and error templates (`errors/not-found.eta`, `errors/forbidden.eta`, `errors/error.eta`). Production 5xx must not leak stacks.

## Secrets

Call `assertProductionSecrets()` from your `createApp` / `serve` path when `isProductionEnv()` is true. Staging counts as production for this check. It is feature-gated: a cookie HTML app with `SESSION_SECRET` and `AUTH_DEV_HEADERS=false` does not need API tokens if those features are off. Generated apps call it at boot. Production boot rejects `FEATURE_PUBLIC_READS=true`.

## Public HTML reads (`FEATURE_PUBLIC_READS`)

Generated `.env.example` sets `FEATURE_PUBLIC_READS=false`. That is the production-safe default.

`HttpKernel.wrapWebPublicRead(handler)` (HTML) and `wrapPublicRead(handler)` (JSON) check the same flag via `isPublicReadsEnabled()`:

| Flag | `wrapWebPublicRead` / `wrapPublicRead` | Anonymous `x-tenant-id` |
|------|----------------------------------------|-------------------------|
| `false` (default) | Requires a signed-in user (`wrapWebAuthenticated` / `wrapAuthenticated`) | Ignored. Guests stay on tenant `1` |
| `true` | Guest HTML/JSON reads (still `wrapWeb` CSRF/session for HTML) | Honored. See [TENANCY.md](./TENANCY.md) |

Storefront pattern (catalog, `/shop`, `make:module` web index):

```typescript
"GET /shop": kernel.wrapWebPublicRead(controller.index),
```

```bash
# .env (local dogfood only)
FEATURE_PUBLIC_READS=true

# .env.production — required. assertProductionSecrets() throws if this is true.
FEATURE_PUBLIC_READS=false
```

Keep production on authenticated HTML or the JSON API. Do not weaken the secrets guard. Anonymous `x-tenant-id` is a separate tenancy concern; the same flag gates both.

## API abilities vs HTML admin

Product apps often authorize the same resource two ways. That is expected.

| Helper | Surface | What it checks |
|--------|---------|----------------|
| `kernel.wrapAbility("products:create")` | JSON (`api` group) | Token/session **ability** string (`RequireAbility`). Pair with a `Policy` / `PolicyGate` inside the controller or `wrapPolicy("products", "create", …)` when the action is on a loaded model. |
| `kernel.wrapPolicy("products", "update", …)` | JSON or HTML | `PolicyGate` + `ProductPolicy` (view/update/delete **this** row). |
| `kernel.wrapWebGlobalAdmin(handler)` | HTML cookie admin | Signed-in, verified (if that extra is on), `users.is_admin`. No ability string. |
| `kernel.wrapWebAbility("products:create", handler)` | HTML | Cookie session + the same ability checker as JSON. |
| `kernel.wrapWebPublicRead(handler)` | HTML catalog | Guest vs login, depending on `FEATURE_PUBLIC_READS`. Not an admin check. |

Shop-style split: JSON `/api/v1/products` uses `wrapAbility("products:*")` plus `ProductPolicy`; HTMX `/admin/products` uses `wrapWebGlobalAdmin`. Admins who pass `is_admin` on HTML do not automatically get JSON abilities — grant `*` or `products:*` on the token/catalog too. See [AUTH.md](./AUTH.md).

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
