# Testing

`bun run test:e2e` runs the preserved security suite against a disposable generated app installed from candidate runtime tarballs, with an owned restricted-role Postgres database. It no longer imports `apps/hiroapp`. Generated CLI/OpenAPI/HTTP smoke acceptance now also runs on an owned temporary app; the private CLI now manages fixtures only, and Docker/workspace wiring no longer depends on checked-in apps after the completed [acceptance migration](GENERATED-APP-ACCEPTANCE.md). External product dogfood lives in [strata-shop](https://github.com/EyK-26/strata-shop). Framework tests also use a **fixture** schema (`src/db`) so RLS and tenant helpers have tables; that fixture is not a product.

## Commands and infrastructure

```bash
docker compose up -d postgres mysql redis --wait
bunx playwright install chromium
bun run validate:host
```

`validate:host` builds packages, resets/seeds only the framework fixture schema, then runs `validate:ci`. Generated runtime cases own their migrations and databases. The root CLI refuses database operations without `STRATA_SCHEMA=fixture`, and refuses staging/production targets before database access. Local `bun test` uses `tests/globalSetup.ts` to initialize fixtures when needed; existing test-reset database/environment guards remain intact.

The three legacy app directories were removed after migrating their assertions to generated-app acceptance. Contributor Compose runs infrastructure only. The root Dockerfile builds a generated app installed from candidate tarballs; `tests/e2e/generatedDocker.test.ts` executes its CLI, production HTTP runtime and graceful shutdown on an owned database. This required test is included in both main CI and release quality gates through `test:e2e`; Docker absence is a failure, not a skip.

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

The generated-module verifier also accepts `--typed-handlers`. It copies a compile-only
contract into the real installed app, then runs its normal `check` script. Positive
calls and negative `@ts-expect-error` cases verify required `id` parameters survive
ability composition and handlers still return HTTP responses. The contract is never
executed by the server. Three additional E2E profiles cover ordinary API routes,
web/API scoped CRUD and a custom API prefix; the original profiles and runtime
assertions remain independent. `--published=VERSION` uses exact published packages.

Module-rendering hashes retain the original pre-extraction fixture. A narrow inverse
transformation permits only the declared controller request annotations and removal
of generated route casts/imports. Every other emitted byte and path must still match
the historical hashes; the fixture is not regenerated to accept unrelated changes.

Source regression tests for generated views, login throttle wiring and request-path RLS isolation use temporary RLS/team profiles through `tests/helpers/generatedSourceApps.ts`. Setup requires every path in the frozen 52-file inventory, and teardown removes its owned source fixtures. The populated failed-job identity upgrade fixture remains under `tests/fixtures/migrations`; current initial-schema generation is not a substitute for testing that historical upgrade. These checks complement, rather than replace, packed-app runtime acceptance.

## Fresh starter account journeys

The [starter journey matrix](STARTER-JOURNEYS.md) exercises fresh account creation, real SMTP verification/reset, MFA, replay, rollback and recovery across external installed apps. It complements seeded-login, OIDC/SAML, CLI/OpenAPI and Docker acceptance; it does not replace those assertions.

The runtime renderer separates database clients/provisioning, migrations and database
commands, model declarations, bootstrap/providers and CLI adapters. `renderRuntime.ts`
retains its original exports as a compatibility facade; generation imports the artifact
owners directly. The frozen eight-profile, 550-file path/hash baseline and all generated
compiler/installed runtime checks still apply. The RLS source fence scans every new
artifact file, permits the same single migrate/seed bypass, and independently asserts
that bootstrap/request handlers contain no unbounded bypass. Moving a renderer does
not authorize changing generated SQL, privilege separation or runtime behavior.


## Generated React browser acceptance

Install the pinned browser once with `bunx playwright install chromium`; Linux contributors may need `bunx playwright install --with-deps chromium`. Main CI and release gates install it explicitly. Missing browser binaries fail acceptance rather than skipping tests. Browser tooling remains a framework development dependency, not a generated app dependency.

`tests/e2e/generatedReactAuth.test.ts` registers built and native Bun dev-proxy browser journeys for all six auth selections in SPA and hybrid apps, plus cookie MFA and JWT expiry cases. Each app installs candidate package archives, runs real migrations and explicit seed, builds/typechecks the frontend, mounts React in Chromium, and exercises the actual client and server. A fixture bridge calls the same browser client module to check authenticated resources, ETags and 401 handling. Additional app modules are acceptance resources; account routes, sessions, bearer signatures, CSRF, password hashing and ORM operations remain the shipped framework APIs.

The verifier also accepts `--published=VERSION` for exact npm acceptance after release. Existing direct HTTP auth journeys, structural matrix, coverage enforcement and other E2E assertions remain required independently. Browser contexts, processes and temporary SQLite databases are owned and closed by each verifier.

## Owned Docker fixture cleanup

The generated production-image verifier removes only its UUID-scoped containers,
image and network. Container teardown also removes anonymous volumes and asserts
that their captured mount names no longer exist. Explicit named volumes are
preserved; no volume prune or age-based ownership inference is used.

`tests/e2e/ownedDockerCleanup.test.ts` exercises real Docker removal after partial
setup, repeated cleanup, named-volume/unrelated-container preservation and an
injected removal failure. The remaining containers are attempted even when one
removal fails, and teardown errors still fail validation. The probes capture their
own mount IDs so their finalizers can clean up even while reproducing a faulty
remover. These checks supplement every existing generated Docker runtime assertion.

### Repository rebinding in installed applications

`tests/e2e/repositoryRebinding.test.ts` runs a generated, installed application on
SQLite, MySQL and PostgreSQL. The consumer creates its business table through a
normal framework migration. Runtime connections use the restricted fixture URLs;
only the migration command receives administrative credentials. The consumer uses
public connection factories, `BaseRepository`, transactions and model events. It
checks native private state, legacy constructor behavior, independent bindings,
rollback, deferred events and reads through separate native connections.

After building core and bootstrap, run the three cases sequentially with:

```sh
scripts/with-host-env.sh env SKIP_FIXTURE_TEST_BOOTSTRAP=1 bun test tests/e2e/repositoryRebinding.test.ts
```

For exact published qualification, invoke the same harness with
`--database=sqlite`, `--database=mysql` or `--database=postgres` and
`--published=<exact-version>`. The existing generated-app fixture pins and verifies
the generator and runtime packages, owns the disposable database/users/files and
closes them after each case. These three cases supplement the existing journey
inventory; they do not replace any auth, module or native-driver assertions.

### Starter rendering boundaries

`packages/strata-starter/src/databaseDefaults.ts` owns the shared development database
names and URLs. Runtime rendering imports it directly, without depending on the
`.env` or README renderers. `renderDocker.ts` renders Compose/image artifacts and
`renderSupportingTools.ts` renders the matching tool instructions. The existing
`renderEnv.ts` exports remain available for callers.

`tests/unit/cli/starterRendering.test.ts` compares every generated file/path against
SHA-256 inventories captured before the extraction, across eight database/frontend/
auth/tool profiles. It uses the existing workspace-dependency output mode without
normalizing or deleting any generated bytes. This keeps unrelated release version
bumps out of these snapshots; existing package-version, compiler, installed runtime,
2,688-shape matrix and published journey assertions continue to check consumer output.
A deliberate generated-output change requires reviewing its corresponding baseline
change as well as keeping the explicit behavior assertions and runtime gates passing.

Auth flow rendering keeps selection policy in `auth/renderingContext.ts`, imports in
`auth/renderImports.ts`, shared account helpers in `auth/renderWorkflows.ts`, JSON/SSO
routes in `auth/renderApiRoutes.ts` and HTML adapters in `auth/renderBrowserRoutes.ts`.
Each fragment accepts only the selection fields it uses. `renderAuthFlows.ts` retains
its existing exports and assembles the same generated module. The helpers already
shared by JSON/HTML remain app-owned; this source extraction does not move generated
operations, change policy or introduce a framework workflow/plugin abstraction.
`authRendering.test.ts` freezes all five auth artifacts across 64 selected profiles
captured before extraction, including independent MFA, verification, GitHub and OIDC
selections. It supplements the original file inventories and installed auth journeys;
it does not replace SMTP, rollback/contention, MFA or credential-revocation assertions.

The environment renderer keeps `renderEnv.ts` as its compatible facade. Its environment/
PostgreSQL provisioning, project metadata and documentation artifacts have separate
source owners. `starterRendering.test.ts` keeps the existing eight generated profiles
and every frozen file hash unchanged, and checks all 16 facade export identities.
The official bump contract also verifies the relocated package-pin source, template
and existing assertion pins, plus frozen install and dedupe stability. The RLS source
fence includes all three new owners with no new bypass exception.

### Owned SMTP fixture admission

Starter auth journeys keep fixed SMTP/HTTP ports across the real Mailpit stop/start
outage. Host-side candidate ports do not atomically reserve ports in Docker's
allocator. `tests/helpers/ownedMailpit.ts` captures the exact container ID with
`docker create` before attempting `docker start`. It removes that owned container
on any later setup failure and retries only a port-binding collision, at most five
startup attempts. It never retries an application request or a journey assertion.
Other startup errors fail immediately after cleanup.

`tests/e2e/ownedMailpit.test.ts` forces actual Docker port conflicts with a separate
owned container, checks bounded exhaustion and cleanup, verifies fixed mappings
across restart, preserves the occupier, and checks non-port error propagation.
Probe teardown independently records created IDs, so a cleanup regression does not
leave its own test resources behind. All original readiness, SMTP outage, auth,
MFA, rollback and contention assertions remain in the unchanged journey body.

### Module cache response contract

`moduleCachedJson.integration.test.ts` exercises both API and web module contexts
through a listening Bun server, their real global middleware, `CacheRepository`
and `SimpleCacheStore`. Tagged/untagged reads, exact and tag invalidation, private
ETags/304 responses, a false JSON payload without a Request and loader failure
followed by a fresh successful load are asserted for both contexts. The helper
owns each server/kernel/cache and restores its environment after failures too.

Both contexts use the existing conditional JSON implementation. Module authors
still choose cache keys/tags and pass the Request when conditional responses are
wanted. This does not add automatic tenant/user key selection, change TTL/store
policy or replace the existing Redis/process/native/published qualification gates.


`verify-starter-module.ts --auth=cookie --with-web --api-prefix=/backend/cache --cached-json`
adds an installed HTTP cache contract after all original module assertions. Its own
module uses only public module/cache APIs and the same `apiPrefix()` convention as
`make:module`. Both API and web contexts must serve tagged/untagged JSON, preserve
ETag/304/private response headers, invalidate and reload, serve request-less false
JSON, and recover from an uncached loader failure. The existing generation, CLI,
OpenAPI, typecheck, auth/denial, HTMX and shutdown assertions remain intact.
`--published=<exact-version>` qualifies the same contract against registry packages.
API and web builders share the neutral route-metadata owner, with the original
`buildModuleRoutes` registration export preserved. `moduleRouteMetadata.test.ts`
characterizes the original registry append behavior, mixed-case method metadata,
plain handlers and intact static response shapes before extraction. It does not
claim that metadata registration implements native transport dispatch. Existing
API/web admission, cache and OpenAPI tests still exercise the real builders.

### Native HTTP response values and callback arguments

`nativeRouteValues.integration.test.ts` exercises real servers with repeated static
and method `Response` values, native request/server identity, request-hook rejection,
configured CORS preflights, explicit OPTIONS precedence and drain before close.
Response-valued API/web module routes pass through their existing middleware;
the installed app additionally proves missing-CSRF rejection and valid-CSRF admission.
Module normalization happens after metadata registration, so registry semantics and
the legacy middleware helper's non-handler passthrough remain unchanged. Middleware
forwards callback arguments with compile-time checks that required arguments stay
required and legacy single-argument handlers do not gain arbitrary arguments.

`verify-repository-rebinding.ts --database=sqlite --native-route-contracts` runs every
original installed repository/transaction/event assertion before this separate HTTP
consumer. Exact published 2.2.48 reproduces the static-response 404; corrected packed
packages pass the same consumer and use the generated app's real providers for API
and web middleware. It adds one installed E2E and next-release qualification profile.
This proof covers response/function routes; it does not qualify HTML bundles,
directory routes or every native Bun static form.

### Installed model serialization hooks

`tests/e2e/modelWriteHooks.test.ts` runs the existing generated-app repository
harness for SQLite, MySQL and PostgreSQL with `--model-write-hooks`. After every
original private-state repository, connection, transaction and event assertion,
the opt-in fixture checks synchronous/asynchronous protected model serialization,
dirty-only updates, unchanged saves, stale unrelated fields, rejection before SQL
and retry on the same instance. It uses the same migrated application table and
restricted runtime credentials; no runtime DDL, extra grant or package patch.

Run `scripts/with-host-env.sh bun scripts/verify-repository-rebinding.ts
--database=<engine> --model-write-hooks` against packed candidates. Adding
`--published=<exact-version>` exercises the same assertions against registry
packages. These are three additional acceptance profiles; the original repository
profiles and assertions remain. The old published 2.2.48 fails this new contract
on all three engines; the corrected candidate passes all three. Historical
113-profile published acceptance remains a record of its original selected scope.

Model attribute transformations now have an internal source owner independent of
model registration, observers, repositories and queries. Existing public imports
of cast helpers remain supported through `database/model`; the complete `Model`,
`ModelQuery` and `ModelProjection` bodies and protected extension dispatch are
unchanged by this mechanical extraction. `model.attributeContracts.test.ts` freezes
the pre-extraction public null/date/JSON/boolean/integer/pass-through/cast-map behavior.
Existing native dirty-write, async-hash, rollback and protected-hook tests remain
required; the extracted owner receives no coverage exemption.

`providerPhaseAdmission.test.ts` exercises real provider contexts with in-memory
cache/storage dependencies. An explicitly started drain/flush must reject work
registered from its very first callback; promise memoization alone occurs too late
for that synchronous admission check. Later phases remain available during an
explicit drain. Existing reverse-order, failure, drain-before-close, repeat disposal
and startup-cleanup tests remain required; a failed drain still keeps infrastructure
open beneath live work.


`verify-repository-rebinding.ts --database=sqlite --provider-phase-admission` also
copies and typechecks an installed consumer of the public provider/context APIs.
Every original repository/transaction/event assertion runs first in its own process;
the additional consumer separately checks phase admission and later-phase cleanup.
Use `--published=<exact-version>` for the same contract against registry packages.
