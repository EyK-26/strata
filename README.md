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
```

## Framework overview

The app boots through **service providers** and **auto-discovered modules** under `src/modules/`. Each module can register DI bindings, policies, and HTTP routes.

### HttpKernel (middleware)

Routes are wrapped by an `HttpKernel` that applies middleware in layers:

- **Global:** structured request logging, `x-request-id`, auth context
- **`api` group:** Redis-backed rate limiting when `REDIS_URL` is set
- **`authenticated` group:** requires a signed-in user (`401` for guests)

Module routes use helpers such as `kernel.wrapAuthenticated(handler)` for protected mutations. See `src/bootstrap/httpKernel.ts`.

### Model-aware authorization

Policies are registered per resource (`organization`, `project`, …). Route handlers use `securedBindRouteModel()` to resolve a model from the URL, then authorize the action against that instance before running the handler.

### Cache, events, and queues

- Tagged cache (`array` or `redis` driver) with automatic invalidation on model writes
- Model lifecycle events dispatched from repositories
- Queue drivers: `sync`, `async`, or `redis` (`QUEUE_DRIVER`)
- Run a Redis worker: `bun run cli queue:work` (requires `REDIS_URL`)

### Facades

Lazy helpers for jobs, listeners, and CLI code live in `src/core/facades/`:

```typescript
import { cache, auth, policyGate, queue, events, config, log } from "../core/facades";
```

### Generators

```bash
bun run cli make:module invoice   # full CRUD scaffold (provider, policy, routes, validation)
bun run cli make:migration create_invoice
bun run cli make:policy invoice
bun run cli make:job sendInvoice
bun run cli make:listener invalidateCache organization.created
```

Generated modules include HttpKernel-aware routes, FormRequest-style body parsing via `validateObject`, and policy hooks for update/delete.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (required) |
| `PORT` | HTTP port (default `3000`) |
| `CACHE_DRIVER` | `array` or `redis` |
| `CACHE_TTL_MS`, `CACHE_MAX_ENTRIES` | In-memory cache limits |
| `REDIS_URL` | Redis for cache, throttling, and queues |
| `QUEUE_DRIVER` | `sync`, `async`, or `redis` |
| `API_TOKEN` | Bearer token for API auth |
| `RATE_LIMIT_PER_MINUTE` | Per-IP/per-path limit (default `120`) |
| `QUEUE_DRIVER` | `sync`, `async`, or `redis` (app defaults to `redis` in Docker) |

Dev/test auth headers (GuestGuard):

- `x-authenticated-user-id`
- `x-authenticated-user-role` (`admin` or `member`)

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
bun run cli queue:work
```

## CLI

Show commands:

```bash
bun run cli help
```

Run migrations:

```bash
bun run cli migrate
```

Check migration status:

```bash
bun run cli migrate:status
```

Rebuild the schema from migrations:

```bash
bun run cli migrate:fresh
```

Rebuild the schema and seed it:

```bash
bun run cli migrate:fresh --seed
```

Run seeders:

```bash
bun run cli seed
```

Rollback the latest migration batch:

```bash
bun run cli rollback
```

Create a migration file:

```bash
bun run cli make:migration create_users
```

Create a module scaffold:

```bash
bun run cli make:module user
```

Start the Redis queue worker:

```bash
bun run cli queue:work
```

In Docker Compose a dedicated `worker` service runs the queue worker alongside the app.

## Operations

Health checks (no rate limiting):

- `GET /health` — liveness probe
- `GET /ready` — readiness probe (Postgres + Redis)

## WorkHub API examples

List endpoints accept validated query params:

- `/organizations?page=1&perPage=10`
- `/projects?organizationId=1&status=active&include=organization`
- `/tasks?projectId=1&status=in_progress&include=project`

Write endpoints accept JSON bodies:

- `POST /organizations` with `{ "name": "...", "slug": "..." }`
- `POST /projects` with `{ "organization_id": 1, "name": "...", "status": "draft" }`
- `POST /tasks` with `{ "project_id": 1, "title": "...", "priority": 2 }`
- `POST /tasks/:id/comments` with `{ "body": "..." }`

Open:

- App: `http://localhost:3000`
- API: `http://localhost:3000/organizations`
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

### WorkHub domain

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

Protected mutations (`PATCH`/`DELETE` on projects, tasks, comments, and organization updates) require authentication. Reports exclude soft-deleted records.
