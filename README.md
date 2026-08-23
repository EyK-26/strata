# WorkHub

**Docker-first** Bun + PostgreSQL + Redis reference application built on **Strata**, a modular TypeScript framework for web apps, with the WorkHub domain (organizations → projects → tasks → comments, attachments, reports, and optional enterprise modules).

Published packages (import **subpaths**, not the root barrel):

| Package | Role |
|---------|------|
| `@getstrata/core` | Framework (`packages/strata-core`) |
| `@getstrata/bootstrap` | HttpKernel, DI, web helpers |
| `@getstrata/cli` | `strata` CLI |
| `@getstrata/starter` | `bun create strata` |

Application code is under `src/modules/`. CI blocks root `@getstrata/core` imports (`scripts/verify-no-root-imports.ts`).

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

getstrata dogfoods **`Bun.markdown.html()`** instead of the `marked` npm package (HTML is still sanitized with `sanitize-html`).

Built-in adoption in Strata / WorkHub:

| Bun 1.4 API | Usage |
|-------------|--------|
| `Bun.markdown` | getstrata docs rendering |
| `Bun.Image` | `GET /attachments/:id/thumbnail?w=` via `@getstrata/core/media/imageTransform` |
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

- `bun run cli migrate`
- `bun run cli seed`
- `bun run start`

After schema changes, rebuild from migrations:

```bash
docker compose exec app bun run cli migrate:fresh --seed
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
bun run cli migrate:fresh --seed && bun run dev
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

Module routes use helpers such as `kernel.wrapAuthenticated(handler)` for protected mutations and `kernel.wrapAbility("projects:delete", handler)` when a bearer token must carry a specific scope. See `src/bootstrap/httpKernel.ts`.

### Frontend modes

Choose how the app is initialized:

| Mode | Env | What you get |
|------|-----|--------------|
| **API-only** (default) | `FRONTEND_MODE=api` | JSON API under `/api/v1`, static landing at `/` |
| **Server + HTMX** | `FRONTEND_MODE=server-htmx` | Eta templates (HTML + `<% %>`, not Pug), cookie sessions, HTMX partials, `/login` |
| **SPA (React)** | `FRONTEND_MODE=spa-react` | Bun + React app served from `/app/*` |

Switch modes in an existing project:

```bash
bun run cli new --frontend=server-htmx
bun run cli new --frontend=spa-react
bun run cli new --frontend=api
```

Server mode adds a parallel **`web` middleware group** with cookie sessions (`SessionGuard`), HTML form validation (`WebFormRequest`), and optional `webRoutes()` on modules. Generate web scaffolding with:

```bash
bun run cli make:module widget --with-web
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

- Production checklist: [docs/PRODUCTION.md](docs/PRODUCTION.md) (`bun run cli secrets:check`)
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

Sign in as `admin@workhub.test` / `password` to access these routes. Core exports: `AdminResourceRegistry`, `formatAdminValue`, `FailedJobService.delete()`, `runQueueJob`.

### Cache, events, and queues

- Tagged cache (`array` or `redis` driver) with automatic invalidation on model writes
- Model lifecycle events dispatched from repositories
- Queue drivers: `sync`, `async`, or `redis` (`QUEUE_DRIVER`)
- Failed job recording with retry/backoff (`queue:failed`, `queue:retry`, `queue:flush-failed`)
- Run a Redis worker: `bun run cli queue:work` (requires `REDIS_URL`)

### Auth and API tokens

Production auth uses database-backed bearer tokens. Seeded tokens after `migrate:fresh --seed`:

```bash
Authorization: Bearer workhub-admin-test-token
Authorization: Bearer workhub-member-test-token
```

Token lifecycle endpoints (authenticated):

- `GET /api/v1/auth/me`: current user
- `GET /api/v1/auth/tokens`: list tokens (requires `auth:tokens:read` or `*`)
- `POST /api/v1/auth/tokens`: create token (`name`, optional `abilities`, `expires_in_days`)
- `DELETE /api/v1/auth/tokens/:id`: revoke a token

Protected mutations require both authentication and a matching ability (for example `projects:delete`, `organizations:update`). The seeded admin token uses `["*"]`; the member token demonstrates read-only scopes. Create scoped tokens via `POST /auth/tokens`.

Set `AUTH_DEV_HEADERS=false` in production and rely on bearer tokens only.

Password and OAuth login:

- `POST /api/v1/auth/login`: `{ "email": "...", "password": "..." }` returns a bearer token (seeded users use password `password`)
- `GET /api/v1/auth/oauth/:provider`: redirect to provider (GitHub when configured; `mock` in non-production)
- `GET /api/v1/auth/oauth/:provider/callback?code=...`: exchange OAuth code for a bearer token

### Audit log, webhooks, and search

- `GET /api/v1/audit-logs`: recent model change audit entries (`audit:read`)
- `GET/POST /api/v1/webhooks`: register outbound webhook endpoints (`webhooks:read`, `webhooks:write`)
- `GET /api/v1/search?q=registry`: PostgreSQL full-text search across tasks and comments

Model writes automatically append audit log entries and dispatch signed webhook payloads (`x-workhub-signature` HMAC).

### OpenAPI and SDK generation

```bash
bun run cli route:list
bun run cli openapi:generate   # writes docs/openapi.json from registered routes
bun run cli sdk:generate       # writes sdk/typescript/client.ts
```

### Facades

Lazy helpers for jobs, listeners, and CLI code live in `src/core/facades/`:

```typescript
import { cache, auth, policyGate, queue, events, config, log, storage, mail } from "../core/facades";
```

### Generators

```bash
bun run cli make:module invoice   # full CRUD scaffold (provider, policy, routes, validation)
bun run cli make:migration create_invoice
bun run cli make:policy invoice
bun run cli make:job sendInvoice
bun run cli make:listener invalidateCache organization.created
bun run cli make:request user
bun run cli make:factory user
```

Generated modules include HttpKernel-aware routes, FormRequest-style body parsing via `validateObject`, and policy hooks for update/delete.

Enterprise patterns:

- Mutations use `kernel.wrapAbility("<resource>:create", handler)`. See generated `routes.ts`
- Optional modules can gate routes with `isFeatureEnabled()` in `index.ts`
- Register policies in `provider.ts` and enforce org scope in services via `membershipScope` helpers
- Show routes use `securedBindRouteModel` with `view` policy; guests retain public read access for hobby/demo

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for SCIM/billing extension points.

### Scheduler, storage, and mail

- `bun run cli schedule:run`: run due scheduled tasks (`src/bootstrap/schedule.ts`); `runDueScheduledTasks` lives in `@getstrata/core`. The WorkHub CLI command is not part of the `@getstrata/bootstrap` public API.
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
bun run cli help
bun run cli route:list
bun run cli openapi:generate
bun run cli sdk:generate
bun run cli queue:work
bun run cli schedule:run
```

## CLI

Show commands:

```bash
bun run cli help
bun run cli tinker
```

Database:

```bash
bun run cli migrate
bun run cli migrate:status
bun run cli migrate:fresh --seed
bun run cli rollback
bun run cli seed
```

Scaffolding:

```bash
bun run cli make:migration create_users
bun run cli make:module user
bun run cli make:request user
bun run cli make:factory user
```

Queue and ops:

```bash
bun run cli queue:work
bun run cli queue:failed
bun run cli queue:retry <id>
bun run cli queue:flush-failed
bun run cli route:list
bun run cli openapi:generate
bun run cli sdk:generate
bun run cli schedule:run
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

- `GET/POST /organizations`, members via `/organizations/:id/members`
- `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`
- `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`
- `GET/POST /tasks/:id/comments`, `GET/PATCH/DELETE /comments/:id`
- `GET/POST /tasks/:id/attachments`, `GET/DELETE /attachments/:id`, `GET /attachments/:id/download`
- `GET /reports/summary`, `GET /reports/organizations/:id`
- `GET /search?q=...`
- `GET /audit-logs`
- `GET/POST /webhooks`
- `GET/PATCH /users/me/notifications`, `PATCH /users/me/notifications/:id/read`
- `GET /billing/subscription` (when `FEATURE_BILLING=true`)
- `GET /admin/stats`, `/admin/tenants`, `/admin/features`, `/admin/organization-members` (global admin, API)
- Web admin (HTMX): `/admin`, `/admin/queue`, `/admin/audit`, `/admin/resources` when `FRONTEND_MODE=server-htmx`
- Auth: `GET /auth/me`, `POST /auth/login`, OAuth routes, token CRUD, `GET /auth/export`, `DELETE /auth/me`

SCIM (`FEATURE_SCIM=true`, bearer token): `/scim/v2/Users`, `/scim/v2/Groups`, …

Protected mutations require authentication and matching token abilities. Reports exclude soft-deleted records. Full route list: `bun run cli route:list` or [docs/openapi.json](docs/openapi.json).
