# Testing

HiroApp is the example product. Framework tests use a leftover **fixture** schema (`src/db`) so RLS and tenant helpers have tables. That fixture is not a product.

## Seeded HiroApp users

After `bun run hiroapp:fresh` (or HiroApp test setup):

| Email | Password | Role |
|-------|----------|------|
| `admin@hiroapp.com` | `password` | Admin (`role_id=1`) |
| `recruiter@hiroapp.com` | `password` | Recruiter (`role_id=3`) |
| `candidate@hiroapp.com` | `password` | Candidate (`role_id=2`) |

## Commands

```bash
bun run unit
QUEUE_DRIVER=sync bun run integration
bun run test:coverage
bun run test:hiroapp
bun run test:hiroapp:coverage
bun run validate:host
```

Docker-shaped CI:

```bash
docker compose run --rm -e QUEUE_DRIVER=sync -e SKIP_FIXTURE_TEST_BOOTSTRAP=1 app bun run validate:ci
```

Host-native: Postgres on `localhost:54329`, Redis on `6379`, MySQL on `33061`. `validate:host` builds packages, migrates the fixture (`STRATA_SCHEMA=fixture`), migrates HiroApp, then runs `validate:ci`. Start MySQL with Compose if you want the live job-board mirror test:

```bash
docker compose up -d postgres redis mysql --wait
```

## What CI migrates

1. Fixture: `STRATA_SCHEMA=fixture bun run cli migrate:fresh --seed`
2. HiroApp: `DOGFOOD_APP=hiroapp bun run cli migrate:fresh --seed`
3. `SKIP_FIXTURE_TEST_BOOTSTRAP=1` so the Bun preload does not reset the fixture a second time

A clean checkout must `bun run build:framework` before HiroApp migrate because `apps/hiroapp` imports `@getstrata/core/*` from `packages/strata-core/dist`.

Local `bun test` without a prior migrate uses `tests/globalSetup.ts` to seed the fixture once. That reset refuses `APP_ENV=production` and non-test `DATABASE_URL` values unless `STRATA_ALLOW_TEST_DB_RESET=1`.

## Tenant-scoped database access

Postgres RLS reads `app.tenant_id` on the connection that runs the query. With a pool (`DB_POOL_MAX > 1`), a session-level `SET app.tenant_id` is not reliable.

Use `runWithTenantDatabase()` from `@getstrata/core/tenant/tenantDatabaseScope` when code talks to tenant tables outside HTTP middleware (tests, scripts, jobs):

```typescript
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";

await runWithTenantDatabase(tenant, async () => {
  // ALS tenant context plus a pinned transaction with SET LOCAL app.tenant_id
});
```

HTTP middleware uses the same helper. Jobs that touch RLS tables must too. See [TENANCY.md](./TENANCY.md).

Cross-tenant migrate/seed work uses `runWithMigrationBypass()`.

For HTML tests, set `FRONTEND_MODE=server-htmx` or `hybrid`. HiroApp `test:hiroapp` uses `hybrid` so staff HTML and `/apply` stay on the same process. Do not flip `FRONTEND_MODE` inside a single test file while other files are running.

Coverage policy: [COVERAGE.md](./COVERAGE.md).

## `createTestApp`

```typescript
import { createTestApp } from "../../src/testing/createTestApp";

const app = await createTestApp();
const response = await fetch(`${app.baseUrl}/health`);
```

That helper boots the **fixture** HTTP map for framework tests. HiroApp tests call `createApp()` from `apps/hiroapp/src/bootstrap/createApp.ts` via `bootHiroapp()` in `apps/hiroapp/src/tests/helpers.ts`.

Set env (`DATABASE_URL`, `QUEUE_DRIVER=sync`) before importing bootstrap modules.

## Local development

```bash
bun run hiroapp:fresh
bun run hiroapp:dev:htmx
```

See [GETTING-STARTED.md](./GETTING-STARTED.md).
