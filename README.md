# WorkHub

**Docker-first** Bun + PostgreSQL + Redis reference application built on **Strata**, a modular TypeScript framework for web apps, with the WorkHub domain (organizations → projects → tasks → comments, attachments, reports, and optional enterprise modules).

Published packages (import **subpaths**, not the root barrel):

| Package | Role |
|---------|------|
| `@getstrata/core` | Framework (`packages/strata-core`) |
| `@getstrata/bootstrap` | HttpKernel, DI, web helpers |
| `@getstrata/cli` | `strata` CLI |
| `@getstrata/starter` | `bun create strata` |

In-repo apps: **HiroApp** (`apps/hiroapp`) is the `bun run dev` default (hiring + Eloquent). **WorkHub** (`src/modules`) stays the Jetstream / SCIM / RLS dogfood and the CI coverage gate (`bun run workhub:dev`). See [docs/DOGFOOD.md](docs/DOGFOOD.md).

CI blocks root `@getstrata/core` imports (`scripts/verify-no-root-imports.ts`).

Pinned versions:

- Bun `1.4.0` (see [Bun 1.4 upgrade notes](https://bun.sh/blog/bun-v1.4))
- PostgreSQL `18.4`
- Adminer `5.4.2`
- TypeScript `5.9` via `tsc` for typechecking and declaration emit (the experimental native TypeScript compiler is not used yet; see below)

The database source of truth is:

- `src/db/migrations`
- `src/db/seeders`

### Bun 1.4

We run CI and Docker on **Bun 1.4.0**. Notable changes from 1.3:

- Node.js compatibility target is **26.3.0** (rebuild native addons if you use any).
- Default lockfile format is **v2**; run `bun install` after upgrading Bun.
- `Temporal` is enabled by default; set `BUN_JSC_useTemporal=0` only if you hit legacy date assumptions.
- `Bun.TOML` is stricter (duplicate keys, invalid UTF-8, oversized integers fail).

Strata mail uses **`Bun.markdown.html()`** plus an allowlist sanitizer (`sanitizeMailHtml`). Do not add `marked` or `sanitize-html` unless a consumer needs them.

Built-in adoption in Strata / WorkHub:

| Bun 1.4 API | Usage |
|-------------|--------|
| `Bun.markdown` | `@getstrata/core/mail/markdownMail` (`markdownToHtml`) |
| `Bun.Image` | Attachment thumbnails and Jetstream profile photos via `@getstrata/core/media/imageTransform` |
| `Bun.cron()` | `schedule:install` / `schedule:uninstall` CLI; optional `SCHEDULER_DRIVER=in-process-cron` |
| `Bun.Terminal` | `shell` CLI via `@getstrata/core/terminal/runShell` |
| `Bun.WebView` | `scripts/smoke-webview.ts` + CI smoke step |
| `bun test --parallel` | CI `test-parallel` job (`--isolate`) |
| `bun dedupe` / `bun audit` | `deps:dedupe`, `deps:audit`, `deps:audit-fix` scripts; CI runs dedupe after install |
| `bun prune --production` | Docker release stage |

### TypeScript

Typechecking and `.d.ts` emit use **`tsc` 5.9**. Bun's built-in transpiler handles runtime TS execution. We do **not** use the experimental native TypeScript compiler (`@typescript/native-preview` / TypeScript 7 `tsgo`) yet: its programmatic API is not ready, and swapping the publish pipeline would be a large breaking change with little benefit until TS 7 ships as stable `tsc`.

## Start

### Docker (recommended)

```bash
docker compose up -d --wait
```

Startup automatically runs:

- `strata migrate`
- `strata seed`
- `strata start`

After schema changes, rebuild from migrations:

```bash
docker compose exec app strata migrate:fresh --seed
docker compose restart app
```

### Native development

With Postgres and Redis reachable via **published Docker ports** (or a local install):

```bash
cp .env.example .env          # Docker Compose service hostnames (inside containers)
cp .env.host.example .env.host  # optional: localhost:54329 / localhost:6379 for host Bun

# Recommended: wrapper sets host URLs automatically
docker compose up -d postgres redis --wait
bun run dev:host

# Or migrate + validate on the host:
bun run validate:host
```

Manual env (equivalent to `dev:host`):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/bun_testing_test \
REDIS_URL=redis://localhost:6379 \
strata migrate:fresh --seed && strata dev
```

See [docs/TESTING.md](docs/TESTING.md) and `.env.host.example`.

## Framework overview

The app boots through **service providers** and **auto-discovered modules** under `src/modules/`. Each module can register DI bindings, policies, and HTTP routes.

Import stable framework types from `@getstrata/core/<subpath>` (see [docs/PACKAGING.md](docs/PACKAGING.md)). Build locally with `bun run verify:framework`.

### HttpKernel (middleware)

Routes are wrapped by an `HttpKernel` that applies middleware in layers:

- **Global:** CORS, security headers, structured request logging, `x-request-id`, auth context
- **`api` group:** Redis-backed rate limiting when `REDIS_URL` is set (keyed by bearer token, user id, or IP)
- **`authenticated` group:** requires a signed-in user (`401` for guests)

Module routes use helpers such as `kernel.wrapAuthenticated(handler)` for protected mutations, `kernel.wrapWebPasswordConfirm(handler)` for Laravel `password.confirm` HTML routes, and `kernel.wrapAbility("projects:delete", handler)` when a bearer token must carry a specific scope. See `src/bootstrap/httpKernel.ts`.

### Frontend modes

Choose how the app is initialized:

| Mode | Env | What you get |
|------|-----|--------------|
| **API-only** (default) | `FRONTEND_MODE=api` | JSON API under `/api/v1`, static landing at `/` |
| **Server + HTMX** | `FRONTEND_MODE=server-htmx` | Eta templates (HTML + `<% %>`, not Pug), cookie sessions (optional `remember` on `/login`), HTMX partials, `/login`, `/register`, `/email/verify` |
| **SPA (React)** | `FRONTEND_MODE=spa-react` | Bun + React app served from `/app/*` |

Switch modes in an existing project:

```bash
strata new --frontend=server-htmx
strata new --frontend=spa-react
strata new --frontend=api
```

Server mode adds a parallel **`web` middleware group** with cookie sessions (WorkHub HMAC `SessionGuard`; sibling HTMX apps use `CookieSessionStore` + the WorkHub `sessions` table), HTML form validation (`WebFormRequest`), and optional `webRoutes()` on modules. Generate web scaffolding with:

```bash
strata make:module widget --with-web
```

SPA dev workflow:

```bash
cd frontend && bun install && bun run dev
```

Production build:

```bash
bun run build:frontend
```

### Adoption tiers

The same codebase scales from hobby projects to enterprise deployments. Enable only what you need:

| Tier | Goal | Key settings |
|------|------|--------------|
| **Hobby** | Learn and prototype | `APP_ENV=local`, `AUTH_DEV_HEADERS=true`, `QUEUE_DRIVER=sync`, `CACHE_DRIVER=array` |
| **Small production** | One team, one region | Rotate tokens, `AUTH_DEV_HEADERS=false`, Redis, backups (see `DEPLOY.md`) |
| **Mid-market SaaS** | Multi-tenant product | `x-tenant-id`, org membership RBAC, `FEATURE_BILLING`, OAuth/OIDC |
| **Enterprise** | Regulated / IdP-driven | `KMS_ENCRYPTION_KEY`, `SCIM_BEARER_TOKEN`, `SIEM_EXPORT_URL`, `OTEL_*` |

Feature flags (`FEATURE_*`) disable optional modules without removing code. See `.env.example`.

- Production checklist: [docs/PRODUCTION.md](docs/PRODUCTION.md) (`strata secrets:check`)
- Tenancy and RLS: [docs/TENANCY.md](docs/TENANCY.md)
- Enterprise integrations (SCIM, billing, SIEM, OAuth): [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)
- Framework packaging & npm: [docs/PACKAGING.md](docs/PACKAGING.md)
- Coverage policy: [docs/COVERAGE.md](docs/COVERAGE.md)
- Disaster recovery: [docs/DR.md](docs/DR.md)
- Operations: [RUNBOOK.md](RUNBOOK.md), [DEPLOY.md](DEPLOY.md)

Seeded API tokens after `migrate:fresh --seed`:

| Token | Abilities | Use case |
|-------|-----------|----------|
| `workhub-admin-test-token` | `*` | Full access |
| `workhub-member-test-token` | read scopes | Scoped member demo |

Seeded password users (HTMX login or `POST /api/v1/auth/login`):

| Email | Password | Role |
|-------|----------|------|
| `admin@workhub.test` | `password` | Global admin |
| `member@workhub.test` | `password` | Member |

### API prefix

WorkHub domain routes are served under **`/api/v1`** by default (`API_PREFIX`). Operational probes stay at the root:

- `GET /health`
- `GET /ready`
- `GET /metrics`: Prometheus text metrics (open locally; production requires `METRICS_TOKEN`)

### Model-aware authorization

Policies are registered per resource (`organization`, `project`, …). Route handlers use `securedBindRouteModel()` to resolve a model from the URL, then authorize the action against that instance before running the handler.

### Admin dashboard (server-htmx)

When `FRONTEND_MODE=server-htmx`, global admins (`role: admin`) can use the web admin UI:

| Route | Purpose |
|-------|---------|
| `/admin` | Platform stats, queue summary, resource links |
| `/admin/queue` | Queue monitor with HTMX polling; retry or delete failed jobs |
| `/admin/audit` | Paginated audit log |
| `/admin/resources` | Read-only resource browser (users, organizations, projects, tasks) |
| `/search` | HTMX search scoped to the current team (`?organizationId=` overrides; JSON stays tenant-wide) |
| `/notifications` | Session inbox (nav bell polls every 30s) |
| `/billing` | Current tenant subscription |
| `/webhooks` | Outbound webhook admin: create (defaults to current team; dispatch is scoped to that team), deactivate, delete, retry delivery |
| `/reports`, `/reports/organizations/:id` | Current-team report (signed-in `/reports` redirects); tenant summary at `/reports?all=1` |
| `/account` | Session profile (name/email), current team, received team invitations, API tokens (Last used), GDPR export/delete, email verification, TOTP MFA + QR + recovery codes, browser sessions (This device + Log out) |
| `/confirm-password` | Laravel `password.confirm` — recent password gate for export and account delete |
| `/two-factor-challenge` | Fortify 2FA challenge after password login (`FEATURE_MFA=true`) |
| `/forgot-password`, `/reset-password`, `/verify-email` | Signed-URL password reset and email verification |

Sign in as `admin@workhub.test` / `password` to access these routes. Core exports: `AdminResourceRegistry`, `formatAdminValue`, `FailedJobService.delete()`, `runQueueJob`, `temporarySignedUrl`.

### Cache, events, and queues

- Tagged cache (`array` or `redis` driver) with automatic invalidation on model writes
- Model lifecycle events dispatched from repositories (`eventBus` is a process-wide singleton so built `@getstrata/core` bundles and app listeners share one bus)
- Queue drivers: `sync`, `async`, or `redis` (`QUEUE_DRIVER`)
- Failed job recording with retry/backoff (`queue:failed`, `queue:retry`, `queue:flush-failed`)
- Run a Redis worker: `strata queue:work` (requires `REDIS_URL`)

### Auth and API tokens

Production auth uses database-backed bearer tokens. Seeded tokens after `migrate:fresh --seed`:

```bash
Authorization: Bearer workhub-admin-test-token
Authorization: Bearer workhub-member-test-token
```

Token lifecycle endpoints (authenticated):

- `GET /api/v1/auth/me`: current user
- `GET /api/v1/auth/tokens`: list tokens (requires `auth:tokens:read` or `*`)
- `POST /api/v1/auth/tokens`: create token (`name`, optional `abilities`, `expires_in_days`; abilities are scoped to the granter)
- `DELETE /api/v1/auth/tokens/:id`: revoke a token (requires `auth:tokens:delete`; on `MEMBER_ABILITIES`)

Protected mutations require both authentication and a matching ability (for example `projects:delete`, `organizations:update`). The seeded admin token uses `["*"]`; login/register member tokens use `MEMBER_ABILITIES` (including `organizations:create` and `auth:tokens:delete`). Create scoped tokens via `POST /auth/tokens` or HTML `/account/tokens` (ability checkboxes). Grants cannot exceed the issuer's abilities.

Set `AUTH_DEV_HEADERS=false` in production and rely on bearer tokens only.

Password and OAuth login:

- `POST /api/v1/auth/login`: `{ "email": "...", "password": "..." }` returns a bearer token (seeded users use password `password`). When `FEATURE_MFA=true` and the account has MFA, omitting `mfa_code` returns 401 `{ two_factor: true, mfa_pending }` plus `workhub_mfa_pending`; complete with `POST /api/v1/auth/two-factor-challenge` `{ code | mfa_code | recovery_code, mfa_pending? }`. One-step login still accepts TOTP or a recovery code on the same request.
- `POST /api/v1/auth/register`: `{ "name", "email", "password", "password_confirmation" }` creates a member, a personal workspace (`{name}'s workspace`, slug `personal-{userId}`), and returns a bearer token (`FEATURE_REGISTRATION`, default on). When `FEATURE_EMAIL_VERIFICATION=true` the response is `{ user }` only and a verify email is sent (the workspace still exists so it is ready after verify). Members can create extra organizations (`organizations:create` is on `MEMBER_ABILITIES`). Jetstream current team is `users.current_organization_id` (`GET/PUT /users/me/current-organization`, HTML `POST /current-organization`). Received team invitations are `GET /users/me/invitations`, `POST /users/me/invitations/:id/accept`, and `DELETE /users/me/invitations/:id` (HTML is `/account`). Creating an organization switches current team; register sets it to the personal workspace. HTML login, MFA complete, and verify-email (no intended URL) send `/organizations` to `/organizations/{current_organization_id}`. Signed-in `GET /` uses that home path; HTML create redirects to the new team show page. Register and organization creates still succeed when an existing webhook URL is blocked (`http://127.0.0.1/…`); the delivery is recorded and the write is not failed.
- `POST /api/v1/auth/forgot-password`: `{ "email" }` always returns a generic success message (does not leak whether the account exists)
- `POST /api/v1/auth/reset-password`: `{ "email", "token", "password", "password_confirmation" }` updates the password from the emailed token
- `POST /api/v1/auth/email/verification-notification`: `{ "email" }` always returns a generic success message (does not leak whether the account exists or still needs verification)
- `GET /api/v1/auth/oauth/:provider`: redirect to provider (GitHub when configured; `mock` in non-production)
- `GET /api/v1/auth/oauth/:provider/callback?code=...`: exchange OAuth code for a bearer token
- HTMX: `GET /oauth/:provider` and `GET /oauth/:provider/callback` set `workhub_session` (no API token) and ensure a personal workspace. Login lists registered providers. `POST /login` accepts `remember=1` for a 30-day HMAC session (`SESSION_REMEMBER_TTL_SECONDS`). When `FEATURE_MFA=true` and the account has MFA, omitting `mfa_code` sets `workhub_mfa_pending` and redirects to `/two-factor-challenge` (TOTP or recovery code). JSON login can send `mfa_code` on `POST /auth/login` or complete Fortify `POST /auth/two-factor-challenge`.

### Audit log, webhooks, and search

- `GET /api/v1/audit-logs`: recent model change audit entries (`audit:read`)
- `GET/POST /api/v1/webhooks`: register outbound webhook endpoints (`webhooks:read`, `webhooks:write`). Lifecycle: `POST /api/v1/webhooks/:id/deactivate`, `POST /api/v1/webhooks/:id/activate`, `DELETE /api/v1/webhooks/:id`, `POST /api/v1/webhooks/deliveries/:id/retry`
- `GET /api/v1/search?q=registry`: PostgreSQL full-text search across tasks and comments, plus organization/project name matches

Model writes automatically append audit log entries and dispatch signed webhook payloads (`x-workhub-signature` HMAC). Team-scoped webhooks (`organization_id` set) only receive events whose payload org matches; `organization_id` null stays tenant-wide. Dispatch coerces driver-string org ids and jsonb `events`, and queues `url`/`secret` on the job so delivery does not depend on an RLS `SELECT` of `webhook`. App listeners are discovered from `src/listeners` via `process.cwd()`. Blocked or invalid webhook URLs are recorded as failed deliveries and do not fail the originating request (`DispatchWebhookJob` swallows `BadRequestError` from `assertSafeOutboundUrl`; the listener also swallows dispatch failures).

### OpenAPI and SDK generation

```bash
strata route:list
strata openapi:generate   # writes docs/openapi.json from registered routes
strata sdk:generate       # writes sdk/typescript/client.ts
```

### Facades

Lazy helpers for jobs, listeners, and CLI code live in `src/core/facades/`:

```typescript
import { cache, auth, policyGate, queue, events, config, log, storage, mail } from "../core/facades";
```

### Generators

```bash
strata make:module invoice   # full CRUD scaffold (provider, policy, routes, validation)
strata make:migration create_invoice
strata make:policy invoice
strata make:job sendInvoice
strata make:listener invalidateCache organization.created
strata make:request user
strata make:factory user
```

Generated modules include HttpKernel-aware routes, FormRequest-style body parsing via `validateObject`, and policy hooks for update/delete.

Enterprise patterns:

- Mutations use `kernel.wrapAbility("<resource>:create", handler)`. See generated `routes.ts`
- Optional modules can gate routes with `isFeatureEnabled()` in `index.ts`
- Register policies in `provider.ts` and enforce org scope in services via `membershipScope` helpers
- Show routes use `securedBindRouteModel` with `view` policy; guests retain public read access for hobby/demo

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for SCIM/billing extension points.

### Scheduler, storage, and mail

- `strata schedule:run`: run due scheduled tasks (`src/bootstrap/schedule.ts`); `runDueScheduledTasks` lives in `@getstrata/core`. The WorkHub CLI command is not part of the `@getstrata/bootstrap` public API.
- Local file storage via `storage()` (`STORAGE_PATH`, default `storage/`)
- Log mail driver via `mail()` for development notifications

### Production lifecycle

- Postgres connections use a configurable pool (`DB_POOL_*` env vars) with health-aware reconnect on `/ready`
- `SIGINT` / `SIGTERM` drain the HTTP server and close database connections via `@getstrata/core` helpers:

```typescript
import {
  installGracefulShutdownSignals,
  registerShutdownHandler,
} from "@getstrata/core/lifecycle/gracefulShutdown";

installGracefulShutdownSignals();
registerShutdownHandler("http-server", () => server.stop());
registerShutdownHandler("database", async () => closeDatabase());
```

- `queue:work` stops cleanly on shutdown signals after the current Redis poll cycle
- Production startup rejects default seed API tokens when `APP_ENV=production`
- Migrations use a Postgres advisory lock for single-flight deploy safety

### Production Docker image

```bash
docker build -t workhub-app .
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The production compose overlay sets `APP_ENV=production`, disables dev auth headers, and runs immutable images without bind mounts.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (required) |
| `PORT` | HTTP port (default `3000`) |
| `APP_ENV`, `APP_DEBUG`, `APP_URL` | Application metadata |
| `API_PREFIX` | API route prefix (default `/api/v1`) |
| `CACHE_DRIVER` | `array` or `redis` |
| `CACHE_TTL_MS`, `CACHE_MAX_ENTRIES` | In-memory cache limits |
| `REDIS_URL` | Redis for cache, throttling, and queues |
| `QUEUE_DRIVER` | `sync`, `async`, or `redis` (app defaults to `redis` in Docker) |
| `QUEUE_MAX_ATTEMPTS`, `QUEUE_BACKOFF_MS` | Job retry settings |
| `AUTH_DEV_HEADERS` | Allow `x-authenticated-user-*` headers (default `true`; set `false` in production) |
| `ADMIN_API_TOKEN`, `MEMBER_API_TOKEN` | Seed tokens for WorkHub users |
| `CORS_ALLOWED_ORIGINS` | CORS allowlist (`*` in development) |
| `RATE_LIMIT_PER_MINUTE` | Per-token/user/IP limit (default `120`) |
| `STORAGE_PATH` | Local storage root (default `storage`) |
| `DB_POOL_MAX` | Postgres pool size (default `10`) |
| `DB_POOL_IDLE_TIMEOUT` | Close idle pool connections after N seconds (default `30`) |
| `DB_POOL_MAX_LIFETIME` | Max connection lifetime in seconds (default `3600`) |
| `DB_CONNECTION_TIMEOUT` | Connection establishment timeout in seconds (default `10`) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OAUTH_REDIRECT_URI` | GitHub OAuth login |

Dev/test auth headers (`GuestGuard`, when `AUTH_DEV_HEADERS=true`):

- `x-authenticated-user-id`
- `x-authenticated-user-role` (`admin` or `member`)

Copy `.env.example` for a full local template.

## Run tests

```bash
# Docker (matches CI)
docker compose run --rm -e QUEUE_DRIVER=sync app bun run validate:ci

# Inside a running app container
docker compose exec app bun run test:all
docker compose exec app bun run test:coverage   # scoped 100% gate; see docs/TESTING.md
docker compose exec app bun run check
docker compose exec app bun run lint:ci
```

On the host (map Postgres/Redis to published ports):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/bun_testing_test \
REDIS_URL=redis://localhost:6379 \
CACHE_DRIVER=redis \
bun run validate:ci
```

Details: [docs/TESTING.md](docs/TESTING.md) (frontend modes, HTMX login, coverage exclusions).

## Lint and format

[Biome](https://biomejs.dev/) handles linting and formatting in one pass:

| Command | Purpose |
|---------|---------|
| `bun run lint` | Check formatting, import order, and lint rules |
| `bun run lint:ci` | Same checks in CI mode (no auto-fix) |
| `bun run lint:fix` | Apply safe fixes + format across the repo |
| `bun run format` | Format only (no lint rules) |
| `bun run validate` | Typecheck, lint, OpenAPI validate, unit + integration tests |
| `bun run validate:ci` | CI parity: above + OpenAPI drift check + scoped coverage gate |

Git hooks (via Lefthook): **pre-commit** formats staged files; **pre-push** runs `validate:host` (migrate + full CI on host Postgres/Redis).

Generated artifacts (`docs/openapi.json`, `sdk/typescript/client.ts`) are excluded from Biome. Regenerate them with the CLI instead of hand-editing.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow. Use `bun run validate` before opening a PR.

## Enter the app container

```bash
docker compose exec app sh
```

Useful commands inside:

```bash
bun run test:all
bun run check
bun run lint
bun run lint:fix
bun run format
strata help
strata route:list
strata openapi:generate
strata sdk:generate
strata queue:work
strata schedule:run
```

## CLI

Framework commands use the `strata` binary from `@getstrata/cli`. Bun stays the runtime, installer, and test runner (`bun install`, `bun test`, `bun run validate`). `bun run cli` is an alias for `strata`.

`strata run <file>` executes a file with the app preload. It is not an alias for `bun run <package.json script>`.

Show commands:

```bash
strata help
strata tinker
```

`strata tinker` banners `${APP_NAME} tinker` (default `WorkHub`).

Database:

```bash
strata migrate
strata migrate:status
strata migrate:fresh --seed
strata rollback
strata seed
```

Scaffolding:

```bash
strata make:migration create_users
strata make:module user
strata make:request user
strata make:factory user
```

Queue and ops:

```bash
strata queue:work
strata queue:failed
strata queue:retry <id>
strata queue:flush-failed
strata route:list
strata openapi:generate
strata sdk:generate
strata schedule:run
```

In Docker Compose a dedicated `worker` service runs the queue worker alongside the app.

## Operations

Health checks (no rate limiting):

- `GET /health`: liveness probe
- `GET /ready`: readiness probe (Postgres + Redis)

## WorkHub API examples

All examples use the `/api/v1` prefix.

List endpoints accept validated query params:

- `/api/v1/organizations?page=1&perPage=10`
- `/api/v1/projects?organizationId=1&status=active&include=organization`
- `/api/v1/tasks?projectId=1&status=in_progress&include=project`

Write endpoints accept JSON bodies:

- `POST /api/v1/organizations` with `{ "name": "...", "slug": "..." }`
- `POST /api/v1/projects` with `{ "organization_id": 1, "name": "...", "status": "draft" }`
- `POST /api/v1/tasks` with `{ "project_id": 1, "title": "...", "priority": 2 }`
- `POST /api/v1/tasks/:id/comments` with `{ "body": "..." }`

Verify auth:

```bash
curl -H "Authorization: Bearer workhub-admin-test-token" http://localhost:3000/api/v1/auth/me
```

Open:

- App: `http://localhost:3000`
- API: `http://localhost:3000/api/v1/organizations`
- Adminer: `http://localhost:8080`

Adminer login:

- System: `PostgreSQL`
- Server: `postgres`
- Username: `postgres`
- Password: `postgres`
- Database: `bun_testing_test`

## After code or dependency changes

```bash
docker compose restart app
```

Local Docker runs `bun install --frozen-lockfile` on startup. If `package.json` and `bun.lock` drift (for example after a pull), the entrypoint falls back to `bun install` and prints a reminder to commit `bun.lock`. CI and the production Dockerfile still require a frozen lockfile.

## Stop

```bash
docker compose down -v --remove-orphans
```

## Main endpoints

### WorkHub domain (under `/api/v1`)

- `GET/POST /organizations`, members via `GET/POST /organizations/:id/members`, `PATCH /organizations/:id/members/:userId`. Invitations: `GET/POST /organizations/:id/invitations`, `DELETE /organizations/:id/invitations/:invitationId`, `POST /organizations/:id/invitations/:invitationId/resend`, `POST /invitations/accept`. HTMX: `POST /organizations/:id/members/:userId/role`, unknown emails send a signed invite (`GET /invitations/accept`); pending invitations can be resent or cancelled
- `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`. Signed-in HTML `GET /projects` defaults to the current team (`?organizationId=` overrides; guests and JSON stay unscoped)
- `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`. Signed-in HTML `GET /tasks` defaults to the current team (`?organizationId=` overrides; guests and JSON stay unscoped)
- `GET/POST /tasks/:id/comments`, `GET/PATCH/DELETE /comments/:id`
- `GET/POST /tasks/:id/attachments`, `GET/DELETE /attachments/:id`, `GET /attachments/:id/download`
- `GET /reports/summary`, `GET /reports/organizations/:id`
- `GET /search?q=...`
- `GET /audit-logs`
- `GET/POST /webhooks`, `POST /webhooks/:id/deactivate`, `POST /webhooks/:id/activate`, `POST /webhooks/:id/delete`, `POST /webhooks/deliveries/:id/retry`
- `GET/PATCH /users/me/notifications`, `PATCH /users/me/notifications/:id/read`
- `GET /billing/subscription` (when `FEATURE_BILLING=true`)
- `GET /admin/stats`, `/admin/tenants`, `/admin/features`, `/admin/organization-members` (global admin, API)
- Web (HTMX): `/admin`, `/admin/queue`, `/admin/audit`, `/admin/resources`, `/search`, `/reports`, `/account`, `/notifications`, `/billing`, `/webhooks` (create defaults to the current team), `/forgot-password` when `FRONTEND_MODE=server-htmx`
- Auth: `GET /api/v1/auth/me`, `POST /api/v1/auth/login`, `POST /api/v1/auth/two-factor-challenge`, `POST /api/v1/auth/register`, `POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/reset-password`, `POST /api/v1/auth/email/verification-notification`, OAuth routes, token CRUD, `PATCH /api/v1/users/me` (`{ name, email }`), `PUT /api/v1/users/me/password` (`{ current_password, password, password_confirmation }`; revokes other API tokens), `POST /api/v1/users/me/logout-other-devices` (`{ password }`; also invalidates older HMAC sessions), `GET /api/v1/users/me/sessions`, `DELETE /api/v1/users/me/sessions/:id`, `POST /api/v1/users/me/confirm-password`, `GET /api/v1/users/me/confirmed-password-status`, `POST /api/v1/users/me/mfa`, `POST /api/v1/users/me/mfa/confirm`, `POST /api/v1/users/me/mfa/recovery-codes`, `DELETE /api/v1/users/me/mfa`, `GET /api/v1/users/me/export`, `GET /api/v1/users/me/invitations`, `POST /api/v1/users/me/invitations/:id/accept`, `DELETE /api/v1/users/me/invitations/:id`, `POST /api/v1/users/me/photo` (multipart field `photo`), `GET /api/v1/users/me/photo`, `DELETE /api/v1/users/me/photo`, `DELETE /api/v1/users/me`. HTMX: `GET/POST /register` (optional same-origin `redirect`), `GET /oauth/:provider`, `GET /oauth/:provider/callback`, `GET/POST /confirm-password`, `GET/POST /two-factor-challenge`, `POST /account/profile`, `POST /account/photo`, `GET /account/photo`, `POST /account/photo/delete`, `POST /account/password`, `POST /account/logout-other-devices`, `POST /account/tokens`, `POST /account/tokens/:id/revoke`, `GET /account/export`, `POST /account/delete`, `POST /account/invitations/:id/accept`, `POST /account/invitations/:id/decline`

SCIM (`FEATURE_SCIM=true`, bearer token): `/scim/v2/Users`, `/scim/v2/Groups`, …

Protected mutations require authentication and matching token abilities. Reports exclude soft-deleted records. Full route list: `strata route:list` or [docs/openapi.json](docs/openapi.json).
