# Testing WorkHub

WorkHub supports three frontend modes (`FRONTEND_MODE`):

| Mode | Value | What runs |
|------|-------|-----------|
| JSON API only | `api` | `/api/v1/*` routes |
| Server HTMX | `server-htmx` | HTML views under `/organizations`, `/projects`, `/tasks`, etc. |
| SPA + API | `spa-react` | React app at `/app/*` plus the JSON API |

Set the mode in `.env` or export it before starting the server.

## Seeded users

After `bun run cli migrate:fresh --seed` (or integration test setup), these accounts exist:

| Email | Password | Role |
|-------|----------|------|
| `admin@workhub.test` | `password` | Global admin |
| `member@workhub.test` | `password` | Member |

## Bearer tokens (API / SPA)

1. `POST /api/v1/auth/login` with `{ "email", "password" }`.
2. Use the returned token as `Authorization: Bearer <token>`.

Integration tests and the SPA client use `cache: 'no-store'` on API fetches.

## HTMX session login

1. `GET /login` — read `csrf-token` meta and `workhub_csrf` cookie.
2. `POST /login` with form fields `email`, `password`, `redirect`, `_token`.
3. Follow `workhub_session` cookie on subsequent requests.

HTMX mutating requests send `X-CSRF-Token` automatically (see `resources/views/layouts/app.eta`).

## Running tests

```bash
# Unit tests
bun run unit

# Integration tests (requires DATABASE_URL, run via Docker in CI)
QUEUE_DRIVER=sync bun run integration

# Full suite with scoped 100% coverage gate — see docs/COVERAGE.md
bun run test:coverage

# CI parity (Docker)
docker compose run --rm -e QUEUE_DRIVER=sync -e WORKHUB_SKIP_TEST_BOOTSTRAP=1 app bun run validate:ci

# Host-native (Postgres/Redis on localhost:54329 / 6379)
bun run validate:host
```

## Tenant-scoped database access

Postgres row-level security reads `app.tenant_id` from the connection that executes each query. With a pooled connection (`DB_POOL_MAX > 1`), session-level `SET app.tenant_id` is not reliable.

Use `runWithTenantDatabase()` from `src/core/tenant/tenantDatabaseScope.ts` whenever code talks to tenant-isolated tables outside the HTTP middleware stack (unit tests, scripts, background jobs):

```typescript
import { runWithTenantDatabase } from "../../src/core/tenant/tenantDatabaseScope";

await runWithTenantDatabase(tenant, async () => {
  // ALS tenant context + pinned transaction with SET LOCAL app.tenant_id
});
```

HTTP middleware (`createTenantMiddleware`, SCIM auth) uses the same helper so production and tests share one code path. Background jobs that touch RLS tables must do the same — see [TENANCY.md](./TENANCY.md).

For migration/seed/bootstrap queries that must read across tenants, use `runWithMigrationBypass()` from `src/core/tenant/databaseTenantContext.ts`.

For HTMX integration tests, set `FRONTEND_MODE=server-htmx`.

CI runs `migrate:fresh --seed` before the test suite and sets `WORKHUB_SKIP_TEST_BOOTSTRAP=1` so the Bun preload does not reset the database a second time. Local `bun test` without a prior migrate uses `tests/globalSetup.ts` to seed once at startup.

Coverage exclusions and rationale: [COVERAGE.md](./COVERAGE.md).

## `createTestApp`

```typescript
import { createTestApp } from "../../src/testing/createTestApp";

const app = createTestApp();
const response = await app.fetch(new Request("http://localhost/api/v1/organizations"));
```

Pass env vars (`DATABASE_URL`, `QUEUE_DRIVER=sync`, etc.) before importing bootstrap modules.

## Local development

```bash
# Host-native against Docker-published ports (recommended on the machine)
bun run dev:host

# Inside Docker Compose app container
docker compose up

# Manual host env
bun run dev
```

`bun run dev` watches `src/bootstrap/server.ts` and reloads on change.

## Frontend (SPA)

```bash
cd frontend
bun install
bun run dev    # Vite dev server (proxy to API in production build)
bun run test   # Component tests (Vitest)
```

Build for production: `bun run build:frontend` from the repo root.
