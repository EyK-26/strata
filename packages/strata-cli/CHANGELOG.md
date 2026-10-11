# @getstrata/cli changelog

## 2.2.16

Allow managed outbox workers to reuse a configured instance, preserving application tenant resolution, listener registration and delivery settings. Keep generated listeners-only defaults compatible, reject ambiguous worker sources, and cover configured SQL delivery, cancellation, cleanup and TypeScript contracts.

## 2.2.15

- Batch legacy list-queue priority polling while retaining recovery and ownership contracts.
- Batch dialect-portable pivot writes with framework transaction/savepoint composition and consistent numeric/string ID toggle semantics. Noncanonical or textual IDs use sequential database comparisons to preserve coercion and collation behavior.
- New Redis scaffolds explicitly select Streams; existing unset transport settings continue to select lists.
- Generate the SQL outbox migration, listener registry and managed worker command. Durable publication and cache-invalidation activation remain explicit.

- Primary-key ascending `chunk` queries reuse the existing keyset walk, including default primary-key ordering; projections, joins, grouping, locks and other orders retain OFFSET behavior.
- Empty filtered pagination totals skip the row query. Nonempty page-number pagination preserves OFFSET semantics and its count-plus-row-query budget; explicit cursor/keyset APIs remain available for deep traversal.
- Independent hashed write casts run concurrently. Deterministic regressions prove concurrent start, complete awaiting and failure before model observers or SQL writes; hydration and existing-hash behavior are preserved.
- Streams workers poll retry promotion, pending recovery and new delivery across priorities in one bounded Redis script, preserving priority, ownership fencing and at-least-once delivery contracts.
- Clarify historical 2.1.0–2.2.13 release notes and database/queue documentation. Remove the consolidated 1.x-to-2.x migration guide; existing projects are upgraded individually.

## 2.2.14

Complete the scoped HTML rendering starter adoption: generated apps inject ViewRenderer through createViewProvider instead of copying renderPage; welcome pages opt into HTMX fragments with full-page fallbacks, auth retains existing contracts, and CORS preserves representation Vary headers. Includes generator, runtime auth and cache-header regressions.

Add optional typed resourceRoutes and strict mergeRouteMaps composition, preserving native Bun routing and app-owned middleware. Add explicit ViewRenderer.namespace prefixes with unchanged layout/Response/HTMX contracts; generated auth controllers use the namespace. Includes native HTTP, compile-time, rendering isolation and generator regressions.

## 2.2.13

- Add a typed per-app HTML renderer on top of the native response path.
- Add explicit HTMX page and fragment responses. A fragment can fall back to the full page. Layout and auth response contracts stay the same.

## 2.2.12

- Require Bun >=1.4.3; align CI, generated/existing example runtime pins and Docker stages to 1.4.3, with bun-types >=1.4.3 behind the official @types/bun shim.

Add identified field-encryption keyrings, reader-first email/MFA configuration, and explicit transactional maintenance rotation for ciphertext and lookup keys with durable checkpoints, RLS scopes, fresh retirement audits and backup/rollback guidance. Fix SQLite primary-key compilation for non-generated keys. Preserve legacy auth defaults; no automatic data migration.

## 2.2.11

Add independently interruptible read-only SQLite and MySQL observations; extend bounded failed-job and outbox metrics to file-backed SQLite and URL-backed MySQL with schema/index guards, real-engine regressions and three-process consistency tests. Preserve Postgres RLS and business transaction behavior.

## 2.2.10

- Add bounded OpenTelemetry SDK health observations and selected native transaction-acquisition histograms through explicit metrics options.
- Add bounded Postgres failed-job counts using ORM ID projections, with schema guards, native acquisition deadlines and read-only collector draining.
- Observe Streams retry promotion lateness using Redis time; cancellation cleanup sentinels omit unavailable age instead of reporting age since epoch.
- Generate typed runtimeMetrics opt-in and provider-owned SQL collector draining, including startup cleanup; HTTP-only defaults and borrowed tracing ownership remain intact.
- Keep additional SQL observation dialects, sustained operational qualification and encryption rotation explicit follow-up work.

## 2.2.9

- Pool checkout can be cancelled. `reserve({ signal })` on the native driver aborts while it is still waiting for a connection. Drivers without that method are not given a fake one.

## 2.2.8

- Add bounded, read-only Postgres outbox metrics.
- Add bounded, opt-in Redis queue metrics. List and Streams depth stay separate.

## 2.2.7

- `ORDER BY` accepts explicit `nulls: "first" | "last"`. Postgres and SQLite emit `NULLS FIRST` / `NULLS LAST`. MySQL has no `NULLS FIRST` / `NULLS LAST` clause, so it orders nulls with an `IS NULL` discriminator and leaves the rest of the sort unchanged.

## 2.2.6

- The CLI, when it supervises the app or worker as a child, forwards shutdown signals to that child and waits for it. The container launcher no longer exits while the child is still running.

## 2.2.5

- Container readiness no longer means the API is admitting traffic. Database readiness no longer provisions roles or creates a missing database. A failed configured admin connection does not fall back to a generated password.

## 2.2.4

- Composite keyset pages on Postgres seek with a row comparison (`(a, b) > (cursor)`), so the planner can start at the index bound instead of expanding the cursor into a chain of OR predicates.

## 2.2.3

- Add scoped composite keyset pagination. The order must end with the primary key. Global scopes and caller filters stay in force across the cursor. Joins, grouping, and offset queries are rejected.

## 2.2.2

- Schema `bigId` emits an explicit 64-bit generated identity.
- Repository writes can be conditional and set-based.
- Repositories and models can take a typed row lock inside the current transaction.
- Generated Postgres query handles keep tagged-SQL typing.

## 2.2.1

- Opt-in Redis Streams (`QUEUE_REDIS_TRANSPORT=streams`). Lists stay the default. Streams adds consumer-group recovery, persisted retry schedules, total job deadlines, opt-in cancellation, and a stable job id across replay. Conversion from lists is a stopped maintenance step.
- Failed jobs stay recorded until retry admission succeeds. Manual replay keeps `failed_job.job_id` when the row has one.
- Public reads and tenant host selection are separate. Unknown hosts fail closed. Forwarded hosts are accepted only from configured trusted proxies.
- Generated apps can provision one initial administrator with `auth:provision-admin` and a one-time claim migration. Demo seeding stays explicit and is rejected in production and staging.
- Quota and in-memory throttle docs match the code: memory throttles stay process-local, and a Redis failure does not fall back to them.

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

- Generated apps reuse the shared config store and base repositories instead of a copied stack.
- Password casts are awaited before the write reaches SQL or observers. Hydration does not hash.
- Model queries keep the concrete model type in their results. Service tokens, route handlers, and the starter's generated infrastructure were tightened in the same release.

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
