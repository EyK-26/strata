# Testing

HiroApp is the in-repo dogfood app. Frontend modes (`FRONTEND_MODE`):

| Mode | Value | What runs |
|------|-------|-----------|
| JSON API only | `api` | `/api/*` HiroApp routes |
| Server HTMX | `server-htmx` | HTML views under HiroApp |
| SPA + API | `spa-react` | React app at `/app/*` plus the JSON API |

Set the mode in `.env` or export it before starting the server.

## Seeded users

After `bun run hiroapp:fresh` (or HiroApp test setup):

| Email | Password | Role |
|-------|----------|------|
| `admin@hiroapp.com` | `password` | Admin (`role_id=1`) |
| `recruiter@hiroapp.com` | `password` | Recruiter (`role_id=3`) |
| `candidate@hiroapp.com` | `password` | Candidate (`role_id=2`) |

## Running tests

```bash
# Framework/core unit tests
bun run unit

# Redis / queue integration tests
QUEUE_DRIVER=sync bun run integration

# Framework/core 100% coverage gate — see docs/COVERAGE.md
bun run test:coverage

# HiroApp domain coverage gate
bun run test:hiroapp:coverage

# CI parity (Docker)
docker compose run --rm -e QUEUE_DRIVER=sync -e WORKHUB_SKIP_TEST_BOOTSTRAP=1 app bun run validate:ci

# Host-native (Postgres/Redis on localhost:54329 / 6379)
bun run validate:host
```

## Tenant-scoped database access

Postgres row-level security reads `app.tenant_id` from the connection that executes each query. With a pooled connection (`DB_POOL_MAX > 1`), session-level `SET app.tenant_id` is not reliable.

Use `runWithTenantDatabase()` from `@getstrata/core/tenant/tenantDatabaseScope` whenever code talks to tenant-isolated tables outside the HTTP middleware stack (unit tests, scripts, background jobs):

```typescript
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";

await runWithTenantDatabase(tenant, async () => {
  // ALS tenant context + pinned transaction with SET LOCAL app.tenant_id
});
```

HTTP middleware (`createTenantMiddleware`, SCIM auth) uses the same helper so production and tests share one code path. Background jobs that touch RLS tables must do the same — see [TENANCY.md](./TENANCY.md).

For migration/seed/bootstrap queries that must read across tenants, use `runWithMigrationBypass()` from `@getstrata/core/tenant/databaseTenantContext`.

For HTMX integration tests, set `FRONTEND_MODE=server-htmx`.

CI runs leftover WorkHub `src/db` migrate/seed (for core tests that inspect `tenant` RLS) plus HiroApp `migrate:fresh --seed` before the suite, and sets `WORKHUB_SKIP_TEST_BOOTSTRAP=1` so the Bun preload does not reset the leftover schema a second time. A clean checkout must `bun run build:framework` before HiroApp migrate because `apps/hiroapp` imports `@getstrata/core/*` subpaths from `packages/strata-core/dist`. Local `bun test` without a prior migrate uses `tests/globalSetup.ts` to seed the leftover schema once at startup. That reset refuses `APP_ENV=production` and non-test `DATABASE_URL` values unless `WORKHUB_ALLOW_TEST_DB_RESET=1`.

Coverage exclusions and rationale: [COVERAGE.md](./COVERAGE.md).

## `createTestApp`

```typescript
import { createTestApp } from "../../src/testing/createTestApp";

const app = await createTestApp();
const response = await fetch(`${app.baseUrl}/health`);
```

Pass env vars (`DATABASE_URL`, `QUEUE_DRIVER=sync`, etc.) before importing bootstrap modules.

## Local development

```bash
bun run hiroapp:dev:htmx
bun run dev
```

## Frontend (SPA)

```bash
cd frontend
bun install
bun run dev
bun run test
```

Build for production: `bun run build:frontend` from the repo root.
