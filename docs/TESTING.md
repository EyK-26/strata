# Testing

`bun run test:e2e` runs the preserved security suite against a disposable generated app installed from candidate runtime tarballs, with an owned restricted-role Postgres database. It no longer imports `apps/hiroapp`. The checked-in app still supplies boot/OpenAPI/smoke fixtures during the staged [acceptance migration](GENERATED-APP-ACCEPTANCE.md). External product dogfood lives in [strata-shop](https://github.com/EyK-26/strata-shop). Framework tests also use a **fixture** schema (`src/db`) so RLS and tenant helpers have tables; that fixture is not a product.

## Seeded example users

After `bun run hiroapp:fresh`:

| Email | Password | Role |
|-------|----------|------|
| `demo@example.com` | `StrataDemo!ChangeMe` | member |
| `admin@example.test` | `StrataDemo!ChangeMe` | admin |

## Commands

```bash
bun run unit
QUEUE_DRIVER=sync bun run integration
bun run test:coverage
bun run validate:host
```

Docker-shaped CI:

```bash
docker compose run --rm -e QUEUE_DRIVER=sync -e SKIP_FIXTURE_TEST_BOOTSTRAP=1 app bun run validate:ci
```

Host-native: Postgres on `localhost:54329`, Redis on `6379`. `validate:host` builds packages, migrates the fixture (`STRATA_SCHEMA=fixture`), migrates HiroApp into `hiroapp_test`, then runs `validate:ci`.

```bash
docker compose up -d postgres redis --wait
```

## What CI migrates

1. Fixture: `STRATA_SCHEMA=fixture bun run cli migrate:fresh --seed` (database from `DATABASE_URL`, usually `bun_testing_test`)
2. HiroApp: `DOGFOOD_APP=hiroapp bun run cli migrate:fresh --seed` (database from `APP_DATABASE_URL`, `hiroapp_test` in `scripts/with-host-env.sh`; without it HiroApp would migrate into `DATABASE_URL` and replace the fixture tables)
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

For HTML tests, set `FRONTEND_MODE=server-htmx` or `hybrid`. Do not flip `FRONTEND_MODE` inside a single test file while other files are running.

Coverage policy: [COVERAGE.md](./COVERAGE.md).

## `createTestApp`

```typescript
import { createTestApp } from "../../src/testing/createTestApp";

const app = await createTestApp();
const response = await fetch(`${app.baseUrl}/health`);
```

That helper boots the **fixture** HTTP map for framework tests. The dogfood app boots with `createApp()` from `apps/hiroapp/src/bootstrap/createApp.ts`.

Set env (`DATABASE_URL`, `QUEUE_DRIVER=sync`) before importing bootstrap modules.

## Local development

```bash
bun run hiroapp:fresh
bun run hiroapp:dev
```

See [GETTING-STARTED.md](./GETTING-STARTED.md).

## Stateful mechanism regression review

A passing clean bootstrap is insufficient evidence for migrations, workers or operator commands. Review the reachable persisted states and the failure boundaries before selecting fixtures. A regression PR must identify the invariant it protects, how it reproduces the original failure, what adjacent paths were checked and what remains unqualified.

For migration/reset changes:

- Populate every framework-owned history store installed by the generated app, as well as app-owned protected history. Exercise each unfinished outbox state independently; mixed fixtures can hide a broken guard for another state.
- Keep ordinary rollback and legacy reset protections, explicit development reset, unsupported environment rejection before database access, opt-in seeding and repeat reset as separate assertions.
- Inject refusal after an earlier successful down, history-record write failure and reapplication failure. Assert both physical schema and migration records, then exercise migrate/retry. A count of applied migrations alone cannot establish schema correctness.
- Run disposable real Postgres, MySQL and SQLite regressions for supported mechanisms. A skipped dialect requires an explicit qualification gap; SQL-string assertions do not substitute for executing the dialect.
- Inspect migration lists for duplicates, invalid exports and applied names missing from disk. Do not assume file discovery or successful status output proves schema consistency.
- State the recovery limits. Partial DDL, process death between DDL and history updates, and concurrent writers require explicit investigation; successful reset does not demonstrate crash atomicity or restore deleted records.

`tests/integration/freshOutboxRecovery.integration.test.ts` executes populated outbox and failure/migrate/retry paths across the three database engines. `tests/unit/migrationRunner.test.ts` additionally injects history-write and reapplication failures. The published-package shop acceptance must populate its complete installed history set and invoke the real CLI after publication; framework source tests alone cannot qualify shop adoption.

Use the same review flow for other stateful changes: enumerate persistent states, define invariants, inject failures at side-effect boundaries, verify persisted outcomes and recovery, then test generated and published consumers. Record newly reproduced defects separately rather than claiming an audit proves no bugs remain. Run the mandatory full validation gate after the final change and disclose intermittent failures, skipped tests and external-provider checks in the PR.

The retroactive reset review reproduced [#174](https://github.com/EyK-26/strata/issues/174): a supplied migration set missing an applied definition leaves its schema in place while the final reset clear removes its history. The preflight fix now refuses reset with missing applied definitions and refuses latest-batch rollback with incomplete definitions, before downs or history deletion. Three-engine regressions verify physical schema, sentinel data and history preservation; unit/file-loader regressions cover duplicates, malformed exports, infrastructure exclusions and partial forward migration. The earlier shop reset fixture also omitted populated outbox deliveries; published-package adoption must correct that omission before declaring the full installed reset path qualified.
