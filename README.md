# 42 API with Bun

Docker-only Bun + PostgreSQL + Redis app built on a **Laravel-inspired TypeScript framework**, with the **WorkHub** reference domain (organizations → projects → tasks → comments + reports).

Pinned versions:

- Bun `1.3.14`
- PostgreSQL `18.4`
- Adminer `5.4.2`

The database source of truth is:

- `src/db/migrations`
- `src/db/seeders`

## Start

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

## Framework overview

The app boots through **service providers** and **auto-discovered modules** under `src/modules/`. Each module can register DI bindings, policies, and HTTP routes.

### HttpKernel (middleware)

Routes are wrapped by an `HttpKernel` that applies middleware in layers:

- **Global:** CORS, security headers, structured request logging, `x-request-id`, auth context
- **`api` group:** Redis-backed rate limiting when `REDIS_URL` is set (keyed by bearer token, user id, or IP)
- **`authenticated` group:** requires a signed-in user (`401` for guests)

Module routes use helpers such as `kernel.wrapAuthenticated(handler)` for protected mutations and `kernel.wrapAbility("projects:delete", handler)` when a bearer token must carry a specific scope. See `src/bootstrap/httpKernel.ts`.

### API prefix

WorkHub domain routes are served under **`/api/v1`** by default (`API_PREFIX`). Operational probes stay at the root:

- `GET /health`
- `GET /ready`

### Model-aware authorization

Policies are registered per resource (`organization`, `project`, …). Route handlers use `securedBindRouteModel()` to resolve a model from the URL, then authorize the action against that instance before running the handler.

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

- `GET /api/v1/auth/me` — current user
- `GET /api/v1/auth/tokens` — list tokens (requires `auth:tokens:read` or `*`)
- `POST /api/v1/auth/tokens` — create token (`name`, optional `abilities`, `expires_in_days`)
- `DELETE /api/v1/auth/tokens/:id` — revoke a token

Protected mutations require both authentication and a matching ability (for example `projects:delete`, `organizations:update`). Seeded admin/member tokens use `["*"]`; create scoped tokens via `POST /auth/tokens`.

Set `AUTH_DEV_HEADERS=false` in production and rely on bearer tokens only.

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

### Scheduler, storage, and mail

- `bun run cli schedule:run` — run due scheduled tasks (`src/bootstrap/schedule.ts`)
- Local file storage via `storage()` (`STORAGE_PATH`, default `storage/`)
- Log mail driver via `mail()` for development notifications

### Production lifecycle

- Postgres connections use a configurable pool (`DB_POOL_*` env vars) with health-aware reconnect on `/ready`
- `SIGINT` / `SIGTERM` drain the HTTP server and close database connections
- `queue:work` stops cleanly on shutdown signals after the current Redis poll cycle

### OpenAPI

A starter spec lives at `docs/openapi.yaml` (base URL `/api/v1`).

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

Dev/test auth headers (`GuestGuard`, when `AUTH_DEV_HEADERS=true`):

- `x-authenticated-user-id`
- `x-authenticated-user-role` (`admin` or `member`)

Copy `.env.example` for a full local template.

## Run tests

```bash
docker compose exec app bun run check
docker compose exec app bun run test:all
```

## Enter the app container

```bash
docker compose exec app sh
```

Useful commands inside:

```bash
bun run test:all
bun run check
bun run cli help
bun run cli route:list
bun run cli queue:work
bun run cli schedule:run
```

## CLI

Show commands:

```bash
bun run cli help
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
bun run cli schedule:run
```

In Docker Compose a dedicated `worker` service runs the queue worker alongside the app.

## Operations

Health checks (no rate limiting):

- `GET /health` — liveness probe
- `GET /ready` — readiness probe (Postgres + Redis)

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

## Stop

```bash
docker compose down -v --remove-orphans
```

## Main endpoints

### WorkHub domain (under `/api/v1`)

- `GET/POST /organizations`
- `GET/PATCH/DELETE /organizations/:id`
- `GET/POST /projects`
- `GET/PATCH/DELETE /projects/:id`
- `GET/POST /tasks`
- `GET/PATCH/DELETE /tasks/:id`
- `GET /comments`
- `GET/PATCH/DELETE /comments/:id`
- `GET/POST /tasks/:id/comments`
- `GET /reports/summary`
- `GET /reports/organizations/:id`
- `GET /auth/me`
- `GET/POST /auth/tokens`
- `DELETE /auth/tokens/:id`

Protected mutations (`PATCH`/`DELETE` on projects, tasks, comments, and organization updates) require authentication. Reports exclude soft-deleted records.
