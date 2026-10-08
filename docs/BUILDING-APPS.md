# Building your own app

HiroApp (`apps/hiroapp`) is in-repo dogfood for internal end-to-end testing. For a product app, use `bunx create-strata` and the published packages.

## Scaffold

```bash
bunx create-strata my-app
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

`strata` installs into the app rather than globally, so use the `bun run` scripts above, or `bunx strata <command>` from inside the app directory.

The CLI is interactive in a terminal. Move with ↑/↓ and Enter, or type a number. Toggle extras that apply to your stack (MFA, email verification, SCIM, metrics, GitHub OAuth, billing, webhooks) with Space. Header auth does not offer MFA, SCIM, or GitHub login. `--no-metrics` skips the metrics extra and does not write `GET /metrics`. For CI, pass `--yes` and layer flags (`--frontend`, `--database`, `--auth`, `--tenancy`, `--cache`, `--queue`, `--mail`). Docker Compose is optional: `--docker`, `--no-docker`, or `--docker-services=postgres,redis`. `--docker` with Postgres or MySQL also writes Adminer at http://localhost:8080.

Layer flags: [STARTER.md](./STARTER.md). The three in-repo apps are generated from that script (`bun run generate:example-apps`). Do not treat HiroApp as the source of the wizard. Only `apps/hiroapp` is CI dogfood.

For typed native Bun transport options, WebSockets, request-hook coverage and streamed-body limits, see [native HTTP configuration](NATIVE-HTTP.md). Review the transport ceiling and hook changes before upgrading existing applications.

## Frontend shapes

Set `FRONTEND_MODE`. Allowed values live in `@getstrata/core/runtime/frontendMode` (`parseFrontendMode`, `FRONTEND_MODE_PATTERN`). Apps should reuse that pattern in their env schema instead of copying a regex.

1. **`api`.** JSON routes only. Clients send Bearer or Basic. Guest JSON login (`POST /api/v1/auth/login` and `POST /api/auth/token`) needs `GET /api/v1/auth/csrf` first. That GET returns the same token it Set-Cookies. Send `X-CSRF-Token` plus the CSRF cookie. A missing token is JSON 403. Bearer and Basic skip CSRF only after that guard authenticates.
2. **`server-htmx`.** Eta HTML + HTMX. Cookie session + CSRF.
3. **`spa-react`.** JSON API plus a SPA document under `SPA_PREFIX` (default `/app`). Prefer opaque tokens for the SPA. Cookie JSON after login needs `GET /api/v1/auth/csrf`.
4. **`hybrid`.** HTML at `/` plus a SPA prefix. Framework SPA routes stay under `SPA_PREFIX` (`/app`, `/app/`, `/app/*` by default) and do not redirect `/`. Apps call `mergeSpaRoutes` with `distDirectory` and `wrap`. Do not copy a second static-file server.

`.eta` files are HTML plus Eta tags (`<% %>`, `<%= %>`, `<%~ include() %>`). Class shorthand such as `section.section` fails at render.

## Cookie HTML apps

```typescript
import { createCookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { CORE_AUTH_TOKEN } from "@getstrata/core/contracts/serviceTokens";

const auth = createCookieSessionAuthManager({
  secret: process.env.SESSION_SECRET,
  cookieName: "myapp_session",
  loadSessionUser, // your SELECT from sessions + users
  mapUser: (user) => ({ id: user.id, role: user.is_admin ? "admin" : "member" }),
});
container.set(CORE_AUTH_TOKEN, auth);
```

Pass `loadSessionUser` whenever the default `SELECT u.*` does not match your `users` table. Generated cookie apps map `is_admin` in `src/bootstrap/providers/auth.ts`.

Use `signIn` / `signOut` (or the redirect helpers). Do not mint cookies in controllers.

`wrapWebGuest` sends already-signed-in people to `/` (pass a path if your home is not `/`). `wrapWebLogin` already includes throttle. Do not wrap it with `wrapWeb` again.

Cookie apps from `create-strata` include restyleable welcome, login, register, and password reset screens in `views/` plus `public/assets/site.css`. Add more routes in `src/modules`.

## Adding API tokens, JWT, or Basic

```typescript
import { DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";

auth.registerGuard("api", new DatabaseTokenGuard(container));
auth.registerGuard("jwt", new JwtGuard(container));
auth.registerGuard("basic", new BasicAuthGuard(container));
```

Bind an `AuthUserDirectory` that can `resolveUserFromToken`, `findByEmail`, and `verifyCredentials`. See [AUTH.md](./AUTH.md) and HiroApp `authDirectory.ts`.

## HTTP kernel

`createHttpKernel(dependencies)` groups middleware (`web`, `api`, `authenticated`). Generated apps use `buildModuleRoutes` / `buildWebModuleRoutes`. `@getstrata/bootstrap/createRoutes` still assembles leftover fixture HTTP for framework tests. It is not your starter.

## Module providers and infra defaults

After `ensureModulesLoaded()`, generated apps run each module's `providers` through the same `register` / `boot` phases as `starterProviders`. Module DI (services, policies) therefore works without calling `collectProviders()` (which would swap in the monorepo `coreProviders` auth stack).

Starter apps also call `registerDefaultJobs` and `await discoverJobs()` when wiring the queue and `registerInvalidateCacheOnModelWriteListeners` during provider boot so cache tags flush through the default invalidation job. `src/listeners/*.ts` registrars are loaded via `await discoverListeners()` in the same boot phase (registration-owned cleanup, same pattern as the monorepo `core.listeners` provider). `src/jobs/*.ts` classes with `static jobName` are registered the same way.

Generated apps combine `starterProviders` and discovered module providers into one ordered list and await the official `createAppContext(providers)` lifecycle. All registrations finish before any boot hook runs; starter providers retain their declared order, followed by module providers. A starter boot hook can therefore resolve a binding from module registration. Modules should register bindings in `register` and consume bindings in `boot`; a registration still cannot depend on a later registration having run. Do not substitute `collectProviders()` in generated apps: its monorepo core providers have different auth/config defaults.

Provider `register` and `boot` hooks accept synchronous implementations or `Promise<void>`. Register resource cleanup immediately through `context.onCleanup(() => resource.close())`. Cleanup captures the resource owned by that context, runs once in reverse acquisition order, awaits each handler, and continues after failures. Rejected registration, boot or dependency validation invokes cleanup without publishing the candidate context. Combined startup/cleanup failures preserve the startup error as the aggregate error's cause. This is resource cleanup, not rollback of external business effects started by a provider.

Successful initialization returns an `InitializedAppContext` with `dispose(): Promise<void>`. Dispose it after stopping application admission/work, then close the database that the app owns. The lifecycle clears only that context's active registry entry; disposing an older context cannot clear a newer one. Redis cache and queue providers register closure of their owned clients; custom providers must register their own resources. Custom listener registrars still own any cleanup they need; async discovery/export validation remains a separate concern.

**Startup API migration:** `createAppContext()`, `createAppDependencies()`, `runProviderPhase()` and the monorepo `App.serve()` are now awaited APIs. This is a source compatibility change and must be included in release migration notes. The `appContext` getters stay synchronous and throw before initialization or after disposal; they no longer initiate hidden startup. Prefer existing async `bootstrapApp()` / `createApp()` in generated apps. Those entry points keep their promise contract, await discovery and database readiness, and close providers before their owned database when later migration/route construction fails. The exported generated `createAppContext()` also awaits module discovery. Calls to the low-level `runProviderPhase()` must supply a complete `ProviderContext` and await it; prefer the lifecycle for failure cleanup.

Generated HTTP binds its socket only after bootstrap succeeds, and bind failure disposes the completed context. Queue workers await boot before constructing a worker and close application resources on failed boot or worker termination. Scheduled commands await boot before inspecting tasks and dispose resources after completion/failure. Custom outbox runners must follow the same ordering: await app bootstrap, then start `outbox.run`; on exit await the worker and dispose its context before database closure. Full bounded HTTP/worker draining and signal deadlines remain the separate lifecycle qualification task.

## Database migrations

### Business transactions and request tenancy

Use `runInTransaction` from `@getstrata/core/database/transaction` around an atomic business operation. Repository queries and queries through the default connection use its active connection. Nested transactions use SQL savepoints: a thrown failure rolls back the nested writes and deferred model events, even if the controller subsequently converts that failure into an HTTP response. Successful nested writes and events remain subject to the outer transaction's commit or rollback.

Keep error-to-response mapping outside the business transaction. Returning a Response, including a deliberate 4xx, is a successful callback and does not request rollback. Await nested transactions sequentially; concurrent sibling savepoints on one connection are rejected. Explicitly supplied repository connections remain the caller's responsibility.

`runWithTenantDatabase` also gives nested RLS scopes a savepoint and restores the previous tenant/bypass settings. Switching tenants inside an active transaction is rejected before changing SQL settings. Nested migration bypass scopes use the same connection and restore the enclosing scope; use bypass only for trusted infrastructure operations. PostgreSQL represents a previously unset custom setting as an empty value after restoration, so treat empty and missing settings as having no identity.

Greenfield apps from `create-strata` use **file-based** migrations in `src/db/migrations/` plus `@getstrata/core/database/migrations` (`migrateDatabase`) from `src/db/migrate.ts`. Seed stays in `migrate.ts`. The runner records applied files in **`framework_migrations`**. See [STARTER.md](./STARTER.md#migrations).

`0001_starter_schema` uses `CREATE TABLE IF NOT EXISTS`. Redis/queue apps include **`failed_job`** there (`queue:failed` / `queue:retry` persist into that table). An inline-SQL app that never created `failed_job` will break those commands even if the rest of the schema looks fine.

### Concurrent Postgres app-role provisioning

`ensurePostgresAppRole` and the generated `postgresAppRoleSql` acquire `SHARE ROW EXCLUSIVE` on `pg_catalog.pg_authid` before checking or changing a role. [Postgres stores this role catalog once per cluster](https://www.postgresql.org/docs/current/catalog-pg-authid.html), so the relation lock coordinates provisioners connected to different databases. Database-local advisory locks cannot provide that guarantee. The lock allows catalog reads but serializes role changes, including changes to other roles; use the admin/superuser provisioning connection and keep these transactions short. Runtime RLS credentials must not provision roles.

The helper submits role creation/update and grants as one SQL batch. Its lock remains held through grant/default-ACL writes and is released at commit, rollback or connection loss. When called inside an explicit transaction it lasts until the caller settles that transaction. New starter scripts use the core SQL renderer and wrap the complete script in `BEGIN`/`COMMIT`, so standalone execution retains the same lock through grants. Existing generated SQL files should be regenerated from the new starter; do not edit application packages or keep a second role helper. Normal standalone role SQL participates in Postgres implicit transactions. Do not wrap provisioning in an HTTP or long-lived application transaction.

Credential behavior is unchanged: explicit `password`, or the database bootstrap's `STRATA_APP_PASSWORD`/existing development default, is applied on both create and update. Provisioners sharing a role must agree on its credentials; conflicting password rotations still require administrative coordination. This is not a password-rotation protocol. `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT` and `NOBYPASSRLS` remain enforced. Custom provisioners need permission to lock the shared catalog; failures do not fall back to uncoordinated writes.

This addresses [#85](https://github.com/EyK-26/strata/issues/85)'s role-provisioning race. Continue running schema migrations once per deployment: role serialization does not serialize independent migration runners, create a missing database concurrently, or coordinate the standalone grant-only helper with arbitrary DDL. No app schema migration or production capacity claim follows from this mechanism fix.

### Adopting file migrations from a legacy inline migrate.ts

Apps scaffolded before file migrations often loop `db.unsafe(...)` in one file and have **no** `framework_migrations` table.

1. Copy the generated shape: `src/db/migrationRuntime.ts` (`loadMigrationsFromDirectory` + `withMigrationDatabase`) and `src/db/migrations/*.ts` (start with `0001_starter_schema` plus your extra tables).
2. Replace the inline SQL loop with `await migrateDatabase(db, await loadStarterMigrations())`. Keep seed in `migrate.ts`.
3. First `bun run db:migrate` creates `framework_migrations` and applies every file not already recorded. Keep `CREATE TABLE IF NOT EXISTS` (and additive `ALTER`s) so a database that already has the tables does not fail on duplicate DDL.
4. If Redis queue is on, add `failed_job` in that first file if the live schema does not have it. `queue:work` atomically creates an individually identified reservation and owner lease before `handle()`. It renews that lease while the handler/retries run, and acknowledges only after success or a successfully persisted failure record. Recovery atomically returns expired work to its pending list; stale owners cannot acknowledge a replacement. `QUEUE_VISIBILITY_MS` defaults to 60 seconds and must be an integer of at least 30 milliseconds. Delivery is at-least-once, so handlers must be idempotent.

When history is untrustworthy:

- **Local / empty data:** `strata migrate:fresh` (generated `src/db/fresh.ts` → `freshDatabase`) runs `down` for recorded files, clears `framework_migrations`, then applies all files. It is destructive. Do not use it on production data.
- **Production / keep rows:** keep `IF NOT EXISTS`, run `migrate` once so the runner records the files, then add later changes as **new** numbered files. Do not hand-insert `framework_migrations` rows unless a file must never run (document why). `migrate:status` shows pending vs `up`.

Do not mix the monorepo fixture runner with a product app’s `src/db/migrations/` on the same database.

## File uploads

`parseMultipartUpload` (JSON / single-file API) already enforces `MAX_UPLOAD_BYTES` / `MAX_REQUEST_BODY_BYTES` and `ALLOWED_UPLOAD_MIME_TYPES` via `@getstrata/core/http/uploads`.

`@getstrata/bootstrap/web/forms` `parseFormBody` is for mixed HTMX forms (fields + `File`). It returns **raw** `files[name]: File` and does **not** apply those guards.

```typescript
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { validateUploadFile } from "@getstrata/core/http/parseMultipartUpload";
import { isAllowedMimeType } from "@getstrata/core/http/uploads";

const { fields, files } = await parseFormBody(request);
const image = files.image;
if (image) {
  const upload = await validateUploadFile(image, "image");
  // upload.fileName, mimeType, size, contents
}
```

Use `parseMultipartUpload(request, "file")` when the request is only that one file field. Do not reimplement the MIME list; import `isAllowedMimeType` / `resolveMaxUploadBytes` from `@getstrata/core/http/uploads`. `UPLOAD_ALLOW_UNKNOWN_MIME=true` is required before `application/octet-stream` is accepted.

## Extending the CLI

Generated apps depend on `@getstrata/cli` (lifecycle commands plus whatever `src/cli/register.ts` exports). The starter writes `src/cli/register.ts` with `queue:work`, failed-job commands, `make:*`, `openapi:*`, and `schedule:run`. `queue:work` calls `bootstrapApp({ migrate: false })` / `createApp()` through `@getstrata/cli/queueWorker` so starter and module providers load. Do not copy the monorepo `queue:work` command (`createAppContext()` from `@getstrata/bootstrap/context`, `coreProviders`).

To add more commands, extend that file (`commands` or `registerCommands()`). Scaffold commands write under `process.cwd()` (`src/modules`, `src/db/migrations`, `src/jobs`). `openapi:*` uses `createApp()` routes. `schedule:run` loads `src/bootstrap/schedule.ts` after boot.

## Optional feature flags

The starter wizard covers MFA, email verification, SCIM, metrics, plus optional `--oauth-github`, `--oidc`, `--billing`, and `--webhooks` (all off by default). SIEM export and hybrid SPA stay env-driven or deferred. See [INTEGRATIONS.md](./INTEGRATIONS.md) and [PRODUCTION.md](./PRODUCTION.md). Outbound webhooks use `await discoverJobs()`, not a `registerWebhookJobs()` helper (that symbol was never exported).

## Views and errors

Configure layout data (`currentUser`, `csrfToken`, `flash`) and error templates (`errors/not-found.eta`, `errors/forbidden.eta`, `errors/error.eta`). Production 5xx must not leak stacks.

## Secrets

Call `assertProductionSecrets()` from your `createApp` / `serve` path when `isProductionEnv()` is true. Staging counts as production for this check. It is feature-gated: a cookie HTML app with `SESSION_SECRET` and `AUTH_DEV_HEADERS=false` does not need API tokens if those features are off. Generated apps call it at boot. Production boot rejects `FEATURE_PUBLIC_READS=true`.

## Public HTML reads (`FEATURE_PUBLIC_READS`)

Generated `.env.example` sets `FEATURE_PUBLIC_READS=false`. That is the production-safe default.

`HttpKernel.wrapWebPublicRead(handler)` (HTML) and `wrapPublicRead(handler)` (JSON) check the same flag via `isPublicReadsEnabled()`:

| Flag | `wrapWebPublicRead` / `wrapPublicRead` | Anonymous `x-tenant-id` |
|------|----------------------------------------|-------------------------|
| `false` (default) | Requires a signed-in user (`wrapWebAuthenticated` / `wrapAuthenticated`) | Ignored. Guests stay on tenant `1` |
| `true` | Guest HTML/JSON reads (still `wrapWeb` CSRF/session for HTML) | Honored. See [TENANCY.md](./TENANCY.md) |

Storefront pattern (catalog, `/shop`, `make:module` web index):

```typescript
"GET /shop": kernel.wrapWebPublicRead(controller.index),
```

```bash
# .env (local dogfood only)
FEATURE_PUBLIC_READS=true

# .env.production — required. assertProductionSecrets() throws if this is true.
FEATURE_PUBLIC_READS=false
```

Keep production on authenticated HTML or the JSON API. Do not weaken the secrets guard. Anonymous `x-tenant-id` is a separate tenancy concern; the same flag gates both.

## API abilities vs HTML admin

Product apps often authorize the same resource two ways. That is expected.

| Helper | Surface | What it checks |
|--------|---------|----------------|
| `kernel.wrapAbility("products:create")` | JSON (`api` group) | Token/session **ability** string (`RequireAbility`). Pair with a `Policy` / `PolicyGate` inside the controller or `wrapPolicy("products", "create", …)` when the action is on a loaded model. |
| `kernel.wrapPolicy("products", "update", …)` | JSON or HTML | `PolicyGate` + `ProductPolicy` (view/update/delete **this** row). |
| `kernel.wrapWebGlobalAdmin(handler)` | HTML cookie admin | Signed-in, verified (if that extra is on), `users.is_admin`. No ability string. |
| `kernel.wrapWebAbility("products:create", handler)` | HTML | Cookie session + the same ability checker as JSON. |
| `kernel.wrapWebPublicRead(handler)` | HTML catalog | Guest vs login, depending on `FEATURE_PUBLIC_READS`. Not an admin check. |

Shop-style split: JSON `/api/v1/products` uses `wrapAbility("products:*")` plus `ProductPolicy`; HTMX `/admin/products` uses `wrapWebGlobalAdmin`. Admins who pass `is_admin` on HTML do not automatically get JSON abilities — grant `*` or `products:*` on the token/catalog too. See [AUTH.md](./AUTH.md).

## Identity env

| Variable | Default when unset |
|----------|--------------------|
| `APP_KEY_PREFIX` | `strata` |
| `APP_NAME` | `Strata` |
| `API_PREFIX` | `/api/v1` |
| `APP_SDK_CLASS` | `${APP_NAME}Client` |

Generated HiroApp pins `APP_KEY_PREFIX=hiroapp`, `APP_NAME=hiroapp`, and `API_PREFIX=/api`. The HTML session cookie is still `strata_session` unless you change `cookieName`.

## Next

- [AUTH.md](./AUTH.md)
- [DATABASE.md](./DATABASE.md)
- [PACKAGING.md](./PACKAGING.md)

## Queue reservation rollout

Stop and drain old workers before starting this reservation implementation. Producers retain the same pending-list envelope, so existing pending jobs need no SQL migration. Never run destructive-pop workers alongside the corrected workers. Preserve pending lists, processing lists, lease hashes and failed-job rows during deployment. Legacy processing entries with timestamp leases are recovered after expiration; newly claimed entries use unique reservation IDs and owners. Reservation and recovery scripts use Redis server time, validate key types before writes, and publish destination state before deleting source state. Commands poll priority lists without blocking the heartbeat connection. Redis ACLs must permit EVAL and its list/hash, TYPE and TIME operations; test the configured worker role before rollout.

Malformed and unregistered jobs are kept as raw payloads in `queue:<priority>:invalid` (under the app namespace) after ownership-checked quarantine. Inspect and repair those payloads before deliberately re-enqueuing them; do not delete them as deployment cleanup. Identical pending payloads have separate reservations and leases. A failure-record database outage leaves the reservation available for recovery rather than acknowledging it. A crash after failure persistence but before acknowledgement may create another failure record on replay.

A stalled process or Redis outage can still lose its lease; its effects may overlap a replay. Lease ownership fences acknowledgement, not arbitrary external side effects. Handlers must use business idempotency. The full F02 Redis Streams migration, stable job IDs, persisted retry schedules, deadlines and cancellation remain follow-up work; this list-based correction does not claim those contracts or measured production capacity.

### HTTP completion includes commit and deferred hooks

The global HTTP error boundary encloses authentication, tenancy, the business transaction, commit, and deferred in-process listeners. API routes keep JSON error responses regardless of `Accept`, including nested `withErrorHandling` wrappers from older scaffolds; HTML routes retain negotiated web error pages. Request IDs, logs, metrics, and tracing observe the final response after that boundary settles. A constraint failure at commit rolls back writes and discards deferred events. A deferred listener failure happens after commit: it returns a controlled error, but cannot undo already committed business data. Handlers and effects must support replay. Use a durable outbox for effects that must survive process death; in-process deferred events alone are not durable.

### SQLite transactions

`createSqliteConnection` supports awaited `begin()` callbacks and the standard `runInTransaction` API. Nested framework transactions use savepoints. A single native SQLite connection serializes root transactions and unrelated queries; transaction-local queries use the bound handle, so another request cannot observe uncommitted writes. Failed callbacks and deferred constraint failures roll back before the next operation starts. Do not nest native `begin()` calls or issue manual transaction-control SQL inside a managed callback; use `runInTransaction`. Drain operations before closing the connection. This does not turn SQLite into a distributed writer database: file locking and the existing busy timeout still apply between processes.

### MySQL transactions

The MySQL adapter reserves a pool connection for each awaited transaction and binds transaction-local pool/repository queries to that session. `runInTransaction` nests through savepoints. Queries with bound values use the prepared protocol; parameterless savepoint/DDL operations use the driver's query protocol. Failed callbacks or commits roll back before release. Uncertain BEGIN and failed rollback discard the session rather than returning it to the pool. Adapters supplied through `createMysqlConnectionFromPool` need `getConnection()` to support transactions; use `runInTransaction` for nesting and do not reuse transaction handles after completion.

### Recoverable model cache invalidation

The 2.x generated queue listener remains a compatibility path: a failed queue dispatch after commit can produce HTTP 500 with no persisted cache retry. SQL applications can opt into durable invalidation through the existing outbox schema. This is a migration, not an automatic bootstrap DDL or a silent error fallback.

Include `createModelCacheInvalidationListener()` from `@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite` in the application's **one** `SqlOutbox` registry, alongside all business listeners. After module discovery and before admitting requests/jobs, call `registerInvalidateCacheOnModelWriteListeners(eventBus, { outbox })`. This replaces the generated queue registrations; later generated-provider calls cannot downgrade it. The returned cleanup restores the previous registration. No separate cache-only worker registry may claim the shared delivery table.

```ts
const outbox = new SqlOutbox({ listeners: [
  createModelCacheInvalidationListener(),
  // ...all application durable listeners
] });
const stopCacheListeners = registerInvalidateCacheOnModelWriteListeners(eventBus, { outbox });
await runInTransaction(async () => {
  await Product.create(attributes);
});
// Separate process, same complete registry and shared cache:
await outbox.work({ signal: shutdown.signal });
```

Row model events publish versioned cache intents through the active business connection before commit. Publication/schema failure rolls back the business write; cache/Redis availability does not participate in the commit response. Later synchronous hooks retain their normal order. The worker directly invokes the framework cache invalidation job, bypassing the Redis queue handoff, and the SQL outbox provides leases, retry, failed-delivery retention and `replay(eventId, "strata.cache.invalidate-tags.v1")`. Tune retry/attempt policy and alert on failed or aged cache deliveries.

Durable mode requires explicit framework transactions around row writes (including workers and CLI commands). The RLS request scope already supplies one. Standalone writes or repositories bound to an unrelated connection fail **before SQL mutation**; this prevents an outbox record from claiming another connection's write. Direct SQL and bulk/projection APIs remain supported escape hatches: explicitly publish `strata.cache.invalidate-tags` with `{ tags }` inside their business transaction when they bypass row events. `EventBus.listenTransactional` hooks are invoked only by model event publication, inside the transaction; normal `dispatch`/`listen` hooks remain synchronous/in-process. Hooks must only persist intents, never perform remote delivery.

Rollout: stop/drain old writers and workers, deploy the outbox file migration with the migration owner, install the complete registry and registrar, and then restart writers and the outbox worker. Preserve old queue jobs and pending SQL deliveries. Use a shared cache for multi-process workers; an array/memory cache belongs to its own process and cannot be invalidated by a different process. Invalidation is eventually consistent: worker lag can expose stale cached values, so use bounded TTLs and bypass cache for authoritative/financial decisions. This fixes recoverability of the handoff. The Redis cache driver also provides shared generation fencing, bounded metadata/LRU eviction and renewable fill leases; see [shared Redis cache](REDIS-CACHE.md) for consistency limits, configuration and the required cold-cache rollout. Existing generated apps must opt in; the legacy 2.x queue mode is not made durable by upgrading packages alone.

### Durable transactional events (opt-in SQL outbox)

Import `SqlOutbox` and `createOutboxMigration` from `@getstrata/core/events/outbox`. Add a numbered application file migration exporting `createOutboxMigration("0010_outbox", "pgsql", { rls: true })` (use the selected driver and enable RLS only for Postgres RLS apps). This helper owns the infrastructure schema; do not copy its SQL into the application. Run migrations separately from workers. MySQL requires 8.0.16+ (8.4 is tested) for `SKIP LOCKED` and enforced checks. Grant the runtime role SELECT/INSERT/UPDATE on both outbox tables. DDL requires the migration owner; migration bypass is a row policy, not DDL permission. Downgrade refuses tables containing any undelivered event.

```typescript
const outbox = new SqlOutbox({
  listeners: [{
    name: "orders.receipt.v1", event: "orders.created",
    async handle(event, { signal }) {
      // Application handler: use event.id as the provider/business idempotency key.
      await sendReceipt(event.payload, { signal, idempotencyKey: event.id });
    },
  }],
});
await runInTransaction(async () => {
  const order = await orders.create(input);
  await outbox.publish("orders.created", { orderId: order.id }, {
    id: `order:${order.id}:created`, version: 1,
  });
});
// Separate bootstrapped worker process; abort during shutdown and await completion.
await outbox.work({ signal: shutdown.signal });
```

Publication requires a framework business transaction (`runInTransaction` or `runWithTenantDatabase`). A savepoint keeps publication atomic even if the caller catches its error. Event payloads are JSON, versioned, limited to 64 KiB by default, and accompanied by the current tenant identity. The transaction captures the registered listener names and attempt budget. Reusing an event ID requires the same name, version, tenant and serialized payload; it never adds listeners retroactively. Canonicalize application payloads if object key ordering may differ between retries. Keep IDs globally unique (include the tenant when business IDs are tenant-local). Retain event rows for the required idempotency/audit window; deleting them permits that ID to be published again.

Durable listeners execute only in workers outside the business transaction; publication never calls a listener or a Redis queue. This differs from synchronous observers and commit-aware in-process model listeners, which are useful hooks but do not survive process death. Register the same durable listeners in producers and workers. Removing or renaming a listener leaves its existing delivery recoverable as a failure. Do not automatically convert all model hooks to durable events: apps choose which effects need durability.

Workers use database time, indexed claim scans, renewable unique ownership tokens and ownership-checked acknowledgement. Expired ownership is reclaimed before new work. Short coordination transactions retry only database deadlock/serialization aborts, with a bounded retry budget; persistent infrastructure errors propagate to the worker supervisor. Delivery is **at least once**. A lease fences acknowledgement, not arbitrary provider effects: a killed worker may have already sent email or charged a provider. Handlers must support replay and observe the abort signal. Cancellation does not delete work. Failed delivery persists a bounded code, not provider exception text; attempts and exponential retry deadlines survive restart. Defaults are a 60-second lease, five attempts, and a one-second initial retry delay capped at five minutes. Provision pool headroom for lease renewal in addition to active listeners. SQLite has one writer per connection; keep application write transactions short.

Tenant listeners resolve the captured tenant and run through `runWithTenantDatabase`, with Postgres RLS bypass disabled. Missing tenants fail closed. The default resolver uses the generated tenant directory; inject the application's trusted directory when its schema differs. Non-RLS handlers receive tenant context and must explicitly use `runInTransaction` for atomic business writes. Platform events have no tenant; reserve them for authorized platform code.

Use `processNext({ signal })` for bounded worker orchestration/tests, or `work({ signal, pollMs })` for the framework polling loop. Monitor pending age, expired leases, attempts, and failed deliveries in the two SQL tables. `replay(eventId, listenerName)` atomically resets only that failed listener's delivery, preserving the original event and completed listeners. Expose replay solely through an authorized operator command, never an anonymous endpoint. Outbox schema/data must survive rolling deployment and restore. This API is additive and opt-in; the starter does not silently change existing listener execution semantics.

### Application OpenAPI operation metadata

Modules may declare `openApi` using the same paths and uppercase methods as their `routes` result (before `apiPrefix`). Metadata for a missing API path/method fails bootstrap; `webRoutes` never enters the API registry. Existing modules and SDK methods retain their defaults when metadata is absent.

```ts
const module: AppModule = {
  name: "orders",
  openApi: {
    "/orders": {
      POST: {
        summary: "Create an order",
        parameters: [{ name: "Idempotency-Key", in: "header", required: true,
          schema: { type: "string", minLength: 16 } }],
        responses: { "200": { description: "Accepted" },
          "409": { description: "Conflicting checkout identity" } },
      },
    },
  },
  routes({ kernel }) { return { "/orders": { POST: kernel.wrap("authenticated", createOrder) } }; },
};
```

The public metadata types describe parameters, JSON Schema, media types, request bodies, response/error schemas, and security overrides following [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.1.html). Provided responses replace generic responses; `security: []` documents a public operation. Metadata documents your handler contract; it does not replace request validation or authorization. Run `openapi:generate` and `openapi:check` after a change. Required path parameters must match the route and header names are case-insensitive for duplicate validation.

The generated fetch SDK keeps `RequestInit` and native `Response` as escape hatches. Declared headers add typed `operationHeaders`; required headers must be supplied, are checked at runtime, and are merged with a native `Headers` instance. For the example: `client.postOrders({ operationHeaders: { "Idempotency-Key": key }, credentials: "include" })`. Declared operation request/response contracts are available in the generated class's `operationContracts`; Declared scalar path/query parameters add typed `operationPath`/`operationQuery`, required-field checks and URL encoding. Cookies use native credentials/headers; JSON decoding, body encoding, advanced parameter serialization and runtime schema validation remain explicit caller responsibilities. This is not a complete OpenAPI-to-TypeScript schema compiler.


### Explicit application CORS headers

For browser callers on an approved different origin, set `CORS_ALLOWED_ORIGINS` to explicit origins and `CORS_ADDITIONAL_ALLOWED_HEADERS=Idempotency-Key,X-Correlation-Id` to extend the framework's existing request-header defaults. The generated HTTP kernel consumes this environment setting; existing applications require no copied CORS middleware. Unset/empty extra headers keep the previous defaults. Names are HTTP field-name tokens, merged case-insensitively; wildcards, empty list entries, whitespace inside names and invalid characters fail middleware construction before admission. Environment entries are comma-separated and trimmed. The typed API accepts exact names:

```ts
import { createCorsMiddleware, type CorsOptions } from "@getstrata/core/http/corsMiddleware";
const options: CorsOptions = { additionalAllowedHeaders: ["Idempotency-Key"] };
const cors = createCorsMiddleware(options);
```

Options and the environment setting both extend defaults; options are copied so subsequent caller-array mutation cannot widen the middleware policy. Existing origin/method/credential behavior is unchanged: only listed origins receive reflected CORS permission and credentials, and development wildcard origins receive no credentials. The framework never reflects arbitrary `Access-Control-Request-Headers`. OpenAPI operation metadata documents a contract, not permission to send its headers from another origin. Authorize origins and extra names deliberately, then deploy/restart writers so invalid settings fail at startup. Header permission does not provide authentication, CSRF exemption or authorization. Same-origin/native clients do not need extra CORS settings. HTTP field-name syntax follows [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1); browser preflight rules follow the [Fetch standard](https://fetch.spec.whatwg.org/#http-access-control-allow-headers).


Registered Bun route method maps need a route-level OPTIONS entry to reach CORS middleware. `createWebServer` synthesizes that preflight handler for registered paths, including GET shorthand and parameterized routes, when the application has no explicit OPTIONS handler. It invokes only the framework CORS policy: no business handler, authentication, CSRF check or tenant transaction runs during the preflight. Actual requests retain their existing middleware checks. Unknown paths keep normal fallback handling. Synthetic OPTIONS entries belong to native server dispatch and do not enter the API route registry/OpenAPI document or mutate the application route map.

Generated apps consume the environment policy above. Custom native server composition may pass `cors: { additionalAllowedHeaders: ["X-Correlation-Id"] }` to `createWebServer` for its synthesized preflights; use the matching approved-header options in the CORS middleware wrapping actual handlers. Explicit application OPTIONS handlers take precedence and own their response policy. Arbitrary `Bun.serve`/fetch handlers are outside this adapter; compose the core middleware there explicitly. Test preflights through the actual generated method map, not only middleware invoked from a catch-all fetch function.

## Typed service tokens and narrow controller dependencies

Use `createServiceToken<T>()` from `@getstrata/core/contracts/container` for new application bindings. Tokens remain string keys at runtime, preserving existing container lifecycle and interoperating with legacy registrations. Their invariant type supplies inference and rejects a mismatched value/factory or an explicit resolution generic that disagrees with the token.

```typescript
import { createServiceToken } from "@getstrata/core/contracts/container";

export const catalogServiceToken = createServiceToken<CatalogService>("catalog.service");

// Provider / composition root:
container.singleton(catalogServiceToken, () => new CatalogService());
const controller = new CatalogController(container.resolve(catalogServiceToken));

// Controller depends on its capability, not the entire application container:
class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
}
```

`container.set`, `instance`, `singleton`, `bind`, `get`, `resolve`, `make` and `resolveService(dependencies, token)` preserve the token's service type. Existing `container.resolve<T>("legacy.key")` callers remain supported. Keep token names unique and export one token declaration per service: creating the same name with a different type does not create a distinct runtime identity. This is a compile-time contract, not runtime validation of values registered through legacy strings, `any`, explicit assertions or JavaScript. Widening a token deliberately to `string` also leaves typed resolution. Prefer typed tokens at both registration and resolution boundaries.

Use constructor parameters for the services a controller actually needs; resolve them in module/provider composition. Stateful services can remain classes, while stateless business operations can remain functions. This API does not alter request scoping, model typing, middleware typing, queues or transactions, and upgrading packages does not rewrite existing controllers.

## Preserve route request types through middleware

`RouteHandler<TRequest>` defaults to the standard `Request`, and accepts a narrower native request contract when a controller needs route parameters. `composeMiddleware`, `withMiddleware`, the `HttpKernel` wrappers and web login/register throttles preserve that contract, so casting parameterized handlers to an untyped `RouteHandler` is unnecessary.

```typescript
import type { RouteHandler } from "@getstrata/core/http/middleware";
import type { RouteRequest } from "@getstrata/core/http/route";

const show: RouteHandler<RouteRequest<{ id: string }>> = async (request) => {
  return Response.json({ id: request.params.id });
};

// Module composition: no handler assertion required.
const route = kernel.wrapWebAuthenticated(show);
```

Middleware still receives standard `Request` and invokes its continuation without replacing the request. Composition returns a handler requiring the original subtype; it does not manufacture route parameters or make a narrow handler safe to call with a plain `Request`. Register it under the matching native Bun path (`/items/:id` in this example). This change does not validate route-map paths, add request fields, decode parameters differently, change authorization/CSRF order, or make middleware-added context available as typed fields. Existing plain-request handlers remain supported. Model binding and JSON/HTML error wrappers compose without erasing the request contract.

### Inferred model results

Static model lookups and writes, query chains, awaited queries, pagination and chunk callbacks preserve the concrete model class and its declared record type:

```ts
class Product extends Model<ProductRecord, "id"> {
  label() { return this.get("title"); }
}
const product = await Product.with("category").findOrFail(id);
const record: ProductRecord = product.toObject();
product.label();
const page = await Product.query().paginate({ page: 1, perPage: 20 });
// page.data is Product[], while find()/first()/firstWhere() remain nullable.
```

Declare record fields to match hydrated values, including configured casts. These types do not validate database rows, cast definitions, mass-assignment input, or dynamically named loaded relations. `withCount("reviews")` adds `reviews_count` to the result record; a custom alias and multiple counts are preserved. Count values remain `unknown` because driver scalar representations and model casts differ; normalize them explicitly before arithmetic. Prefer aliases that do not overwrite model fields.

Writes and filters infer declared field names and value types. Use `Product.query().select("title", "price").get()` for plain selected records with model casts; these rows have no model methods or unselected fields. Model-returning `all` and `firstWhere` helpers do not accept partial selects. Repository queries, direct SQL and bulk operations remain available; `pluck` and `value` retain their existing `unknown` results. Use `newFromTrustedRecord` for deliberate partial SQL hydration, where the caller owns completeness. See [typed model inputs and projections](./DATABASE.md#typed-model-inputs-and-projections) for defaults, cast boundaries, dynamic predicates and source compatibility.

### Model composition

For ordinary SQL models, extend `defineModel(table)` from `@getstrata/core/database/model` with a typed `defineTable` definition. Generated startup awaits `discoverModels` from `@getstrata/bootstrap/discoverModels`; the framework supplies default repositories and registers relationship names before boot. Use `bootModels([...])` with static imports when filesystem discovery is unsuitable, and retain `registerModelRepository` only for explicit custom repository bindings. Existing manually registered models are compatible. See [DATABASE.md](./DATABASE.md#declarative-model-binding) for startup ordering, aliases and migration guidance.

### Graceful lifecycle

Generated HTTP, queue worker and scheduler entrypoints coordinate stop, drain, flush and close phases. Providers can register `onCleanup(handler, "drain")` for admitted work, `onCleanup(handler, "flush")` for telemetry, and default cleanup for resource closure. Existing custom entrypoints must adopt the coordinator explicitly. See [LIFECYCLE.md](LIFECYCLE.md) for integration, deadlines and recovery contracts.

### Awaited infrastructure discovery

Jobs and listener modules load through awaited ESM imports before provider startup finishes. Malformed exports and duplicate discovered job/module names fail startup with their locations. Use explicit manifests for bundles and preserve DI factories instead of reconstructing their dependencies. See [DISCOVERY.md](DISCOVERY.md) for supported file/export shapes, caching and migration requirements.
