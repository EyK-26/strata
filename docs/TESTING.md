# Testing

`bun run test:e2e` runs the preserved security suite against a disposable generated app installed from candidate runtime tarballs, with an owned restricted-role Postgres database. It no longer imports `apps/hiroapp`. Generated CLI/OpenAPI/HTTP smoke acceptance now also runs on an owned temporary app; the private CLI now manages fixtures only, and Docker/workspace wiring no longer depends on checked-in apps during the staged [acceptance migration](GENERATED-APP-ACCEPTANCE.md). External product dogfood lives in [strata-shop](https://github.com/EyK-26/strata-shop). Framework tests also use a **fixture** schema (`src/db`) so RLS and tenant helpers have tables; that fixture is not a product.

## Commands and infrastructure

```bash
docker compose up -d postgres mysql redis --wait
bun run validate:host
```

`validate:host` builds packages, resets/seeds only the framework fixture schema, then runs `validate:ci`. Generated runtime cases own their migrations and databases. The root CLI refuses database operations without `STRATA_SCHEMA=fixture`, and refuses staging/production targets before database access. Local `bun test` uses `tests/globalSetup.ts` to initialize fixtures when needed; existing test-reset database/environment guards remain intact.

The three legacy app directories remain pending the final removal step, but they are no longer workspaces or boot/image inputs. Contributor Compose runs infrastructure only. The root Dockerfile builds a generated app installed from candidate tarballs; `tests/e2e/generatedDocker.test.ts` executes its CLI, production HTTP runtime and graceful shutdown on an owned database. This required test is included in both main CI and release quality gates through `test:e2e`; Docker absence is a failure, not a skip.

Focused commands:

```bash
bun run unit
bun run test:coverage
scripts/with-host-env.sh bun run verify:generated-runtime
scripts/with-host-env.sh bun test tests/e2e/generatedDocker.test.ts
```

Docker acceptance creates its own network, Postgres and Redis containers and credentials. It never resets the contributor/shop databases or changes their Redis connections. Owned resources use unique `strata-docker-*` names and `strata-acceptance:*` image tags. After forcibly terminating a verifier, inspect those names before assuming cleanup ran.

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

That helper boots the **fixture** HTTP map for framework tests. Generated packed-app acceptance boots the generated `createApp()` in an isolated process.

Set env (`DATABASE_URL`, `QUEUE_DRIVER=sync`) before importing bootstrap modules.

## Local development

Use the infrastructure and full validation commands above. To explore product behavior, generate an external app or use strata-shop; the framework root has no `dev` or `start` product server.

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

## Generated CLI runtime and API scope

After rebuilding core/bootstrap, run `scripts/with-host-env.sh bun run verify:generated-runtime` for generated CLI OpenAPI and native HTTP acceptance. The command selects two native E2E cases, each preserving the complete 40-operation runtime inventory. For one profile use Bun’s `-t` filter on `tests/e2e/generatedRuntime.test.ts`, or invoke `bun scripts/verify-generated-runtime.ts --openapi` / `--http` directly. `bun run smoke` owns its HTTP server fixture and retains the separate integration-extra and built-SPA checks, so it no longer needs a running HiroApp. The complete chain is included in `validate:ci`, including release validation.

The corrected `docs/openapi.json` contains 22 API/protocol operations. The older 40-operation snapshot accidentally included 18 HTML operations because the legacy adapter discarded middleware metadata. See [the preservation and correction evidence](GENERATED-APP-ACCEPTANCE.md#second-pr-generated-cliopenapi-and-http-smoke). No runtime endpoint was removed.

Source regression tests for generated views, login throttle wiring and request-path RLS isolation use temporary RLS/team profiles through `tests/helpers/generatedSourceApps.ts`. Setup requires every path in the frozen 52-file inventory, and teardown removes its owned source fixtures. The populated failed-job identity upgrade fixture remains under `tests/fixtures/migrations`; current initial-schema generation is not a substitute for testing that historical upgrade. These checks complement, rather than replace, packed-app runtime acceptance.
