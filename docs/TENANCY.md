# Tenancy and row-level security

`TENANCY_DRIVER` chooses how tenant context is stored:

| Driver | Database | What it does |
|--------|----------|--------------|
| `none` | any | No `tenant` table. Middleware still sets an async-local default tenant (`id` 1). It does not query `tenant` or run `SET LOCAL`. |
| `column` | any | Creates a `tenant` table and `users.tenant_id`. Requests resolve the tenant in application code (ALS). No Postgres `SET LOCAL` / `set_config`. Use this on SQLite and MySQL, or on Postgres when you do not want RLS. |
| `rls` | Postgres | Same tenant table plus `SET LOCAL` / `set_config('app.tenant_id')` on the connection that runs queries. SQLite and MySQL cannot do this. `create-strata` coerces `--tenancy=rls` to `column` on those engines. |

The default in core (unset env) is `rls`. Generated apps write the driver you picked into `.env.example`. Hobby SQLite defaults to `none`.

HTTP requests and background jobs must call `runWithTenantDatabase()` when RLS is on so `app.tenant_id` is set on the connection. Migrations, seeds, and audit export use `runWithMigrationBypass()`, which opens a transaction and `SET LOCAL app.bypass_rls=true`. That unbounded GUC is migrate/seed/audit only. Request auth lookups use `runWithMigrationBypassForIdentifier()`, which opens its own transaction and `SET LOCAL app.bypass_identifier` to the caller-supplied id, email, session id, or token hash. The helper does not rewrite SQL. The policy is the pin: `users` match `id::text` or `email`; `sessions` match `id` or `user_id::text`; `api_tokens` and `auth_one_time_tokens` match `token_hash` or `user_id::text`. Notes and other tenant data honour unbounded `app.bypass_rls()` or `tenant_id = app_current_tenant_id()` only. After the user or session is known, follow-up SQL in the same request uses the request tenant GUC. Note / SCIM / `/health` SQL does not wrap bypass. `column` and `none` skip those Postgres session GUCs. Postgres RLS is the only driver with database-level enforcement; SQLite and MySQL apps should use `column` (application ALS) or `none`.

## Generated HiroApp

`apps/hiroapp` (dogfood for internal end-to-end testing) sets `TENANCY_DRIVER=rls`. The generated schema creates a `tenant` table, seeds slug `default` (id `1`), stores `users.tenant_id`, and puts `tenant_id` on **data** tables such as `notes`. Postgres RLS apps emit `app_current_tenant_id` / `app_bypass_rls` / `app_bypass_identifier` helpers and `ENABLE` + `FORCE ROW LEVEL SECURITY` on `notes` and `users` via `generatedRlsBootstrapSql`. Cookie `sessions`, `api_tokens`, and `auth_one_time_tokens` get a join policy (`users.tenant_id = app_current_tenant_id()`) plus the identifier pin on the real key columns. Auth directory lookups, cookie session reads and writes, token mint, password reset, email verify, and one-time token consume/insert use `runWithMigrationBypassForIdentifier()`, which sets `app.bypass_identifier` and does not set unbounded `app.bypass_rls`. Session and token loads select the auth row first, then the user by id, because a JOIN cannot match both policies at once. One-time consume passes `hashOneTimeToken(token)` so the policy can match `token_hash`. Those policies apply to non-superuser, non-`BYPASSRLS` roles. Generated Compose still creates a `postgres` superuser for volume init, GRANT, migrate, and `migrate:fresh` DROP. Runtime `DATABASE_URL` uses `strata_app` (`NOSUPERUSER` `NOBYPASSRLS`), including `--no-docker`. `db/ensure-postgres-app-role.sql` is repeatable on an existing volume; docker-entrypoint-initdb.d still runs only on first empty volume. Live `pg_roles` runs on every rls runtime pool after it is open (`ensureAppDatabase` + `getSql()`). Username `postgres` or `root` is the URL denylist fast path. Named superuser (`deploy`) is the live inspect. The HiroApp e2e denylist test is the postgres URL fast path. The live inspect e2e is `assertRlsLiveDatabaseRole()` on the `strata_app` pool. It inspects `APP_DATABASE_URL` if set, else `DATABASE_URL`, and never `MIGRATION_DATABASE_URL`. `hiroapp-team` is `TENANCY_DRIVER=none`, so FORCE RLS and the live rls role check are not the control there. SCIM isolation is tenant GUC plus `WHERE tenant_id`. `currentTenantId()` throws if ALS is missing. `createHealthRoutes` without `pingOnHealth` is always 200 JSON and does not read notes. HiroApp `/health` is `schemaReady` (`Note.query().limit(1).get()` under the request tenant; empty notes 200, unreadable not 200). Docker HEALTHCHECK fetches `/health`.

Sibling examples `hiroapp-hobby` and `hiroapp-team` set `TENANCY_DRIVER=none`. A SQLite or MySQL app that wants tenant rows should pass `--tenancy=column`.

## Fixture schema (framework tests)

Core tests still isolate a leftover fixture schema (users, audit, webhooks, and similar) with `app_bypass_rls()` or `tenant_id = app_current_tenant_id()`. That fixture is not a second product. Do not copy those fixture tables into a generated app.

## Auth lookups before tenant GUC

Auth middleware runs before tenant middleware. Lookups that must succeed before `app.tenant_id` is set either bypass RLS or stay off RLS.

| Table | Why |
|-------|-----|
| Generated `users` | `ENABLE` + `FORCE ROW LEVEL SECURITY` on `--tenancy=rls`. Auth directory `findById` / `findByEmail` wrap `runWithMigrationBypassForIdentifier()` with that id or email. Token lookup selects `api_tokens` by `token_hash`, then `users` by `user_id`. Password reset, email verify, MFA enroll, and recovery-hash updates also wrap that identifier-scoped GUC so guest requests (tenant `1`) can update a user in another tenant. After tenant GUC is set, ordinary user queries (including SCIM) are tenant-scoped. |
| Generated `api_tokens` (fixture name `api_token`) | `ENABLE` + `FORCE ROW LEVEL SECURITY` with a join to `users.tenant_id`, plus identifier match on `token_hash` or `user_id::text`. Bearer lookup runs in auth middleware **before** tenant middleware, so it wraps `runWithMigrationBypassForIdentifier(token_hash)` then a second call with `user_id`. Token mint wraps the user id so a guest request (tenant `1`) can insert a row for a user in another tenant. |
| Generated `sessions` | Same join policy as `api_tokens`, plus identifier match on `id` or `user_id::text`. Cookie session load selects the session by id, then the user by `user_id`. Session create/destroy wrap `runWithMigrationBypassForIdentifier()` with the session id or user id. `ForIdentifier(user id)` may see that user's sessions and tokens. That is the session-create pin, not a one-row-only policy. |
| Generated `auth_one_time_tokens` | Same join policy, plus identifier match on `token_hash` or `user_id::text`. Insert wraps the user id. Consume wraps `hashOneTimeToken(token)` so guest password-reset and verify links work for users outside tenant `1`. |
| Optional membership joins | If your app uses membership middleware, it also runs **before** tenant middleware so roles exist for the rest of the request. Generated HiroApp does not use org membership. It stores `users.tenant_id`. |

Global middleware order: auth, then membership, then tenant. Do not reverse that order.

## Default tenant for anonymous requests

Unauthenticated requests still need a tenant (login, register, CSRF). They use tenant `1` (`DEFAULT_TENANT`).

`x-tenant-id` on anonymous requests is honored only when `FEATURE_PUBLIC_READS=true`. Guests already pin to tenant `1`, so `/login` works with `FEATURE_PUBLIC_READS=false` (the code and `.env.example` default). Production boot requires the flag to stay false so guests cannot probe other tenants via that header.

Authenticated non-admin users are pinned to their account tenant. Global admins may override with `x-tenant-id`.

## Background jobs

Jobs that touch RLS tables must call `runWithTenantDatabase()` with an explicit tenant from the job payload. Do not rely on a leftover pooled `app.bypass_rls` or `app.tenant_id` from a previous request.

Webhook dispatch jobs require `tenantId` and scope lookup and delivery to that tenant. Blocked outbound URLs (`assertSafeOutboundUrl`) are recorded and do not fail the originating model write.

`runWithTenantDatabase()` (and `runInTransaction()`) defer `BaseRepository` model events until the transaction commits. A throw drops those events. Re-entering a same-tenant scope on an active connection uses a SQL savepoint and restores the outer tenant, bypass, and bypass-identifier settings. Switching tenants inside an active transaction is rejected. Await sibling scopes sequentially. An exception converted to an HTTP error response by framework error handling rolls the open transaction or savepoint back; a normal 4xx return does not. See [DATABASE.md](./DATABASE.md) and [INTEGRATIONS.md](./INTEGRATIONS.md#outbound-webhooks).

### Application metadata and quota policies

Core tenant context now requires only `id` and `slug`. Optional `metadata` is trusted application data (`Readonly<Record<string, unknown>>`); core does not interpret plans, regions, prices or entitlements. `resolveTenant(id)` selects only identity columns, so new generated tenant tables need no commerce columns. Existing plan/region columns and historical migrations can remain until the application explicitly migrates them. Additional context fields remain opaque extensions for source compatibility, but the default resolver no longer loads them.

With tenancy enabled, bind `CORE_TENANT_RESOLVER_TOKEN` from `@getstrata/core/contracts/serviceTokens` to an asynchronous application resolver before constructing routes. The kernel uses it after authentication selects the tenant ID. It must return that same ID; null produces 403 rather than falling back to a different tenant, and returning another identity is rejected. Direct middleware callers can pass `createTenantMiddleware({ resolveTenant })`. Resolve metadata from trusted persistence, never a caller-supplied plan/entitlement header. The resolver cannot change tenant selection, public-access policy, RLS or membership checks. Single-tenant `TENANCY_DRIVER=none` retains the synthetic default identity. Durable outbox workers have their own `resolveTenant` option; supply the same application resolver there when listeners require metadata.

Bind `CORE_THROTTLE_QUOTA_POLICY_TOKEN` to a synchronous `ThrottleQuotaPolicy` for the kernel's API group, or pass `quotaPolicy` directly to `createThrottleMiddleware` / `createMemoryThrottleMiddleware`:

```ts
import { CORE_THROTTLE_QUOTA_POLICY_TOKEN } from "@getstrata/core/contracts/serviceTokens";

container.set(CORE_THROTTLE_QUOTA_POLICY_TOKEN, ({ tenant, maxAttempts }) => {
  return tenant?.metadata?.entitlement === "education" ? 240 : maxAttempts;
});
```

The policy receives the request, current tenant, framework-resolved user/token/client identity, registered route template (or `__unmatched__`) and configured base limit. It returns a non-negative safe integer: zero denies every request. Missing/unknown metadata should use an application-defined conservative limit. The policy runs before store consumption; invalid results or exceptions produce a secret-safe 503. Keep it fast and synchronous: load metadata in the trusted tenant resolver, rather than making provider calls in the policy. The fixed window (`decaySeconds`) and bucket namespace/tenant/method/route/identity remain framework mechanisms. Changing a quota does not reset its current counter. Redis increment and expiry stay atomic; Redis failures still produce 503 without a local fallback. All replicas must deploy the same policy and window configuration.

Kernel login, registration and SCIM protections retain their dedicated configured limits; the API quota token does not loosen them. Explicit local throttles can use the same policy, but retain their existing process-local storage semantics; bounded storage and normalized local bucket identities are a separate follow-up.

**Migration / compatibility:** `rateLimitMultiplierForPlan` is removed from public exports. Redis throttles no longer apply implicit free/pro/enterprise multipliers. Applications relying on those limits must explicitly install their own policy and metadata resolver before rollout. This is a public behavior/source change, not a patch-only release. No automatic database deletion or data migration is performed. New generated tenant seeds insert only the slug; old applications can keep their schema and add commerce migrations themselves.

### Bounded process-local throttles

API, login and SCIM memory throttles now share a bounded fixed-window store. Each middleware retains at most 10,000 hashed buckets by default (`maxBuckets`, configurable from 1 to 1,000,000), and removes at most 32 expired entries per attempt (`pruneBatchSize`, from 1 to 1024), plus a directly expired target if necessary. Fixed expiry and insertion order avoid full-map scans. Idle stores retain bounded expired entries until the next attempt or disposal; no sweeping timer keeps the process alive. Expiry uses a monotonic clock, so wall-clock corrections do not extend lockouts. Windows must be finite, non-negative, and at most 2,147,483,647 milliseconds.

A full store rejects new identities with the framework's 503/Retry-After response. Existing identities keep their counters, including lockouts: eviction of live buckets would allow identity flooding to reset those limits. Bounds apply per middleware instance, so application owners must also budget the number of configured middleware instances. Expose `stats()` for retained bucket count, last bounded pruning batch and disposal state; call `dispose()` to clear owned state and reject subsequent use. These stores remain local to one process and do not provide cross-replica rate limits.

Generic local buckets now use the same namespaced tenant/method/registered-route/trusted user-token-client identity as Redis throttles. Unknown paths collapse to `__unmatched__`; arbitrary Authorization values cannot create authenticated identities. Login buckets additionally use normalized email, and SCIM buckets use a hashed presented credential. Local login/SCIM state is now owned by each middleware instance rather than a process-global map; distinct instances do not share counters. Use one configured instance for routes intended to share a local limiter. Never treat instance recreation as a lockout-reset mechanism.

The generated kernel registers disposal with its application context, after HTTP drain and telemetry flush. Custom disposable throttles can join that lifecycle through `kernel.ownThrottle(throttle)`; generated SCIM routes do this. Direct kernel users without an application context call `kernel.dispose()`, and direct middleware users call `dispose()` themselves. Test reset functions use a lazy generation reset instead of retaining every middleware in a global registry.

Reproduce the controlled local cardinality probe with `bun scripts/probe-memory-throttle.ts`. On Bun 1.4.2/macOS, 100,000 distinct client identities and item paths admitted exactly 1,024 clients at a configured 1,024-bucket budget, retained 1,024 buckets (about 429 KB observed heap growth), and released every bucket on disposal. Sampled local p99 was about 0.006 ms; this isolated probe is not a throughput or production capacity promise. Regressions also exercise TTL backlog cleanup with at most 16 pruned entries per consume, retained hot lockouts at saturation, concurrent identities and separate application cleanup.

These identity and ownership changes are public behavior changes. Existing distributed throttles do not fall back to memory on a Redis outage. The legacy SCIM Redis gap was recorded in [framework issue #109](https://github.com/EyK-26/strata/issues/109); the distributed consumer correction below supersedes that implementation.


### Distributed throttle ownership and SCIM migration

API, login and SCIM Redis throttles now reuse the same atomic increment/expiry script and deadline-bounded consumer. SCIM uses its hashed credential plus the same application namespace, trusted token tenant, HTTP method and registered route identity; the canonical token-to-tenant lookup binds valid credentials even when throttling runs before SCIM authentication enters its RLS scope. Unrecognized credentials retain the surrounding/anonymous scope for pre-auth admission; it keeps its own fixed quota and JSON 429 contract. Malformed counters, unavailable Redis and command deadlines return the framework's secret-safe 503 with Retry-After, never a memory fallback. Handler errors remain business errors. SCIM accepts `commandTimeoutMs`, `redisClient` and `keyPrefix`, matching the shared consumer's injection and namespace contracts.

The consumer and distributed middleware expose idempotent `dispose()`. Disposal closes only an owned Redis connection, cancels pending admission immediately, and permanently prevents reconnects. Injected clients stay owned by the caller. Cancellation removes deadline timers and abort listeners; it cannot undo a command already received by Redis, so an uncertain attempt may still be counted, but never reaches the handler after disposal. A command failure resets an owned connection so a later request can retry with a fresh connection; it cannot revive a disposed consumer. The kernel now owns distributed API, registration and login throttles as well as local ones; generated SCIM routes already join this ownership boundary. Application close still follows HTTP drain, so handlers already admitted can finish before resources close.

**SCIM rolling deployment:** the default bucket namespace is now `scim-throttle:v2`. Old identity-only counters are not imported into tenant/method/route buckets, and limits are now per registered route and method rather than one credential-wide counter. This is a documented behavior change: mixed old/new replicas cannot enforce one shared SCIM window. Use a maintenance rollout or coordinated cutover with a consistent configuration across replicas. After retiring all old replicas, operators can remove the retired `APP_KEY_PREFIX:scim-throttle:*` keys using bounded SCAN/UNLINK maintenance, explicitly excluding `APP_KEY_PREFIX:scim-throttle:v2:*` (or the configured new prefix). Old immortal counters may otherwise remain; no application request scans Redis or silently deletes live quota state. No automatic migration resets current counters. Direct middleware/consumer users dispose their resources; injected Redis clients must be closed by their original owner.
