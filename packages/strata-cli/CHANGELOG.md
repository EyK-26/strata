# @getstrata/cli changelog

## 2.2.11

Add independently interruptible read-only SQLite and MySQL observations; extend bounded failed-job and outbox metrics to file-backed SQLite and URL-backed MySQL with schema/index guards, real-engine regressions and three-process consistency tests. Preserve Postgres RLS and business transaction behavior.

## 2.2.10

- Add bounded OpenTelemetry SDK health observations and selected native transaction-acquisition histograms through explicit metrics options.
- Add bounded Postgres failed-job counts using ORM ID projections, with schema guards, native acquisition deadlines and read-only collector draining.
- Observe Streams retry promotion lateness using Redis time; cancellation cleanup sentinels omit unavailable age instead of reporting age since epoch.
- Generate typed runtimeMetrics opt-in and provider-owned SQL collector draining, including startup cleanup; HTTP-only defaults and borrowed tracing ownership remain intact.
- Keep additional SQL observation dialects, sustained operational qualification and encryption rotation explicit follow-up work.

## 2.2.9

- Support native cancellable transaction acquisition

## 2.2.8

- Add bounded read-only Postgres outbox metrics

## 2.2.7

- Where an ordinary operation needs SQL because the framework cannot express it

## 2.2.6

-  fix(cli): relay shutdown to children and simplify container launcher

## 2.2.5

-  fix(starter): keep container readiness independent of API admission

## 2.2.4

-  perf(database): seek Postgres composite keyset bounds

## 2.2.3

- feat(database): add scoped composite keyset pagination

## 2.2.2

- orm improvments

## 2.2.1

F02 — complete queue durability. Queues have leased reservations, recovery and fenced acknowledgement, but still use Redis lists. Persisted retry schedules, execution deadlines, cancellation and the planned Streams migration remain unfinished. Retries currently wait inside the running worker.
F10 — production public-route tenancy. Separate anonymous access from development tenant headers, support a trusted-host resolver, reject unknown hosts, and accept forwarded hosts only through configured trusted proxies. The shop still lacks the approved-domain mapping.
F12 — initial administrator provisioning and migration guidance. Automatic demo seeding is fixed. Secure initial-admin provisioning and a consolidated upgrade/operations guide remain.
Distributed qualification. Cache generations/fill leases, scheduler ownership, OpenTelemetry, body limits and lifecycle controls now exist. Their implementation should no longer be described as entirely pending, but broader failure and capacity qualification is still required.

## 2.2.0

Consistent model scopes.
Changed-field model writes.
Awaited provider startup.
Shared cache correctness.
Native HTTP controls and body limits.
Graceful lifecycle.
Validated async discovery.
Stronger model input types.
OpenTelemetry tracing.
Distributed scheduler ownership.
App-owned quota policy.
Bounded memory throttling.

## 2.1.0

- refactor(starter): reuse shared config and base repositories - fix(database): await password casts before model writes - fix(database): preserve concrete model types in query results

## 2.0.9

- fix(starter): remove demo credentials from public login defaults

## 2.0.8

- fix(schema): preserve constraints and generate builder migrations

## 2.0.7

- Fix concurrent Postgres role provisioning across databases

## 2.0.6

- Dispatch registered Bun route preflights through CORS

## 2.0.5

- Allow explicitly approved application headers in CORS

## 2.0.4

- Place cache rollout guidance beside outbox docs without overlapping API additions

## 2.0.3

- Persist transactional events with leased tenant-aware SQL outbox workers

## 2.0.2

- Adopt TypeScript 7.0.2 in framework and generated apps; preserve tested TypeScript 5.9 and 6.x consumer compatibility.
- Verify six generated app configurations against three compiler versions and typecheck/build React SPA and hybrid frontends.
- Declare Bun-supported CSS imports in the SPA scaffold for TypeScript 7.

## 2.0.1

- Fix release lockfile drift and CLI 2.x peer compatibility

## 2.0.0

- Strata 2.0: compose business transactions and tenant scopes

## Unreleased

- Await queue/scheduler application startup and close resources after failed startup or completed work; preserve original failures when cleanup also fails.

- 2.0: migrations no longer implicitly call an app seed export. Seeding requires --seed; fresh accepts the same explicit flag. Missing seed exports are rejected before applying migrations or resetting data.

## 1.1.9

- Defer model events until the surrounding transaction commits

## 1.1.8

- Exclude HTML and SPA routes from generated OpenAPI specs

## Unreleased

- `openapi:generate` (and validate/check) keep JSON API and health routes and drop HTML-only (`web` without `api`) and SPA-prefix paths instead of restamping the full hybrid table as API.

## 1.1.7

- Fix generated webhook SQL, billing hook, and hybrid SPA smoke

## 1.1.6

- Add optional OIDC cookie login and loopback discovery

## 1.1.5

- Close dogfood gaps: webhook docs, starter extras, signing helper

## Unreleased

- `make:module` appends a `registerModelClass` hint to `src/models/register.ts` when that file exists.
- `openapi:check` drift output reminds you to run `openapi:generate` in CI.

## 1.1.4

- Publish http/uploads, validateUploadFile, migration-adoption docs

## 1.1.3

- Eager with() arrays, OpenAPI mkdir, public-read/auth docs

## 1.1.2

- Product CLI helpers, file migrations, and job discovery.

## Unreleased

- Export `queueWorker`, `queueFailed`, `scaffold`, `openapi`, and `schedule` subpaths. Generated apps register `queue:work` through `runQueueWorkerCommand({ boot, close })` (no secrets guard in the helper), plus failed-job commands, `make:*`, `openapi:*`, and `schedule:run`. Monorepo `queue:failed` / `retry` / `flush-failed` go through `createQueueFailedCommands()` so they type as `StrataCommand`. `boot` may return a value (`bootstrapApp()` returns the app).
- `make:job` emits `static jobName`. `make:request` imports `@getstrata/core/http`. `make:module --with-web` writes `views/` when that directory exists.
- Peer dependencies on `@getstrata/core` and `@getstrata/bootstrap`.

## 1.1.1

Fix generated app boot

## 1.1.0

Lockstep with `@getstrata/core` 1.1.0. No new CLI commands. See the core 1.1.0 migration list.

## 1.0.9

Label HiroApp as internal e2e dogfood and seed notes via Model

## 1.0.8

- Container image starts and ships production dependencies only.

## 1.0.7

## 1.0.6

- Lockstep with `create-strata` 1.0.6. No runtime changes.

## 1.0.5

- Lockstep with `create-strata` 1.0.5. No runtime changes.

## 1.0.4

- Lockstep with `create-strata` 1.0.4. No runtime changes.

## 1.0.3

- Lockstep with `create-strata` 1.0.3. No runtime changes.

## 1.0.2

- Lockstep with `create-strata` 1.0.2. No runtime changes.

## 1.0.1

- `strata --help` and `strata -h` print help instead of reporting an unknown command.
- `migrate` and `migrate:fresh` call an optional `close()` export from the app's migrate entry. Without it, a pooled driver such as `mysql2` kept the event loop alive and the command hung after finishing its work.
- Dropped the `prepublishOnly` build. It produced a `dist/` that `files` never shipped; the `bin` is the Bun TypeScript entry.
- README no longer advertises `strata new`, which this package does not implement.
- `migrate` prints `Migrations applied.` and `migrate:fresh` prints `Database reset and migrated.` on success instead of exiting silently.

## 1.0.0

- First stable release of the `strata` binary: `dev`, `start`, `migrate`, `migrate:fresh`, `run`, plus app-registered commands.
