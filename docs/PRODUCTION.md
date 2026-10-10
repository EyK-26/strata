# Production readiness

Existing applications should follow the [1.x → 2.x migration guide](MIGRATING-2.md) before enabling new runtime mechanisms.

`assertProductionSecrets()` runs when `isProductionEnv()` is true: `APP_ENV=production` or `NODE_ENV=production` (case-insensitive), `APP_ENV=staging`, or an unrecognized `APP_ENV` value. HiroApp and generated apps call it from `createApp()`. The check is feature-gated: flags that are off do not demand their secrets.

Validate:

```bash
APP_ENV=production strata secrets:check
```

Fix every error until it prints that production secret checks passed.

Provision the first operator through the explicit [initial-admin command](INITIAL-ADMIN.md); demo seeding is not a production provisioning method.

## Required for all production deployments

| Variable | When |
|----------|------|
| `APP_ENV=production` | Always |
| `APP_URL` | Always. The public origin (`https://...`); signed links and redirects are built from it. Localhost is rejected. |
| `APP_DEBUG=false` | Always (recommended) |
| `AUTH_DEV_HEADERS=false` | Always in production. `GuestGuard` is always null when `isProductionEnv()` is true, including staging, even if this flag is `true`. Local `AUTH_DEV_HEADERS=true` still reads request headers. |
| Identity response headers | Never set. `x-authenticated-user-id`, `x-tenant-id`, and `x-tenant-region` are not written on responses. |
| `DATABASE_URL` | Always at runtime. When `TENANCY_DRIVER=rls`, every rls runtime pool (including local) rejects username `postgres` or `root`, then inspects live `pg_roles` for `rolsuper` / `rolbypassrls`. The check inspects `APP_DATABASE_URL` if set, else `DATABASE_URL`. It never inspects `MIGRATION_DATABASE_URL`. Generated and HiroApp runtime URLs use `strata_app`. `MIGRATION_DATABASE_URL` may stay the superuser for CREATE ROLE / GRANT / migrate. `hiroapp-team` is `TENANCY_DRIVER=none` and does not run this check. |
| `SESSION_SECRET` (32+ chars) | `FRONTEND_MODE=server-htmx` or `hybrid` |
| `ADMIN_API_TOKEN`, `MEMBER_API_TOKEN` | When those env vars are set or `FEATURE_API_TOKENS=true`. Rotate away from `strata-*-test-token` and any leftover published seed strings |
| `TOKEN_HASH_PEPPER` | Token auth enabled |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Token auth enabled |
| `OAUTH_STATE_SECRET` | OAuth / OIDC / SAML enabled |
| `CORS_ADDITIONAL_ALLOWED_HEADERS` | Optional comma-separated explicit application request-header names; extends defaults and rejects invalid names/wildcards. It does not authorize origins or grant CSRF exemptions. |
| `CORS_ALLOWED_ORIGINS` | Only when browsers on other origins call the API. Unset is `APP_URL` locally and same-origin in production. Never defaults to `*`. `*` is rejected in production. |
| `FEATURE_PUBLIC_READS=false` | Default authenticated-read policy. Public catalogs may opt in per route with `{ allowAnonymous: true }` or enable the default policy. Neither enables guest tenant headers. Tenancy-enabled production guest requests require `CORE_PUBLIC_TENANCY_TOKEN`; generated apps approve their configured `APP_URL` hostname for starter tenant 1. Unknown hosts fail closed. |
| `TENANT_DEV_HEADERS=false` | Required in production/staging. Exact `true` permits development-only guest tenant-header selection. Forwarded hosts instead require explicit immediate socket-peer IP trust; see [TENANCY.md](./TENANCY.md#trusted-public-tenancy-and-public-read-admission). |

A production HTML app needs `DATABASE_URL`, `SESSION_SECRET`, and `AUTH_DEV_HEADERS=false`. It does not need API tokens, SCIM, OAuth, or CORS when those features are off.

## When a feature is on

See [INTEGRATIONS.md](./INTEGRATIONS.md).

| Feature flag | Required env | Notes |
|--------------|--------------|-------|
| `FEATURE_FIELD_ENCRYPTION=true` | `KMS_ENCRYPTION_KEY` (32-byte hex or base64), or explicit `KMS_ENCRYPTION_KEYRING` | Encrypted columns you opt into |
| `FEATURE_MFA=true` | `KMS_ENCRYPTION_KEY` (32-byte hex or base64), or explicit `KMS_ENCRYPTION_KEYRING` | Required to store TOTP secrets, including local/dogfood |
| `FEATURE_SCIM=true` | `SCIM_BEARER_TOKEN` (rotated) | Optional `SCIM_TENANT_TOKENS` per tenant |
| `FEATURE_BILLING=true` | `STRIPE_WEBHOOK_SECRET` | Stripe SDK stays in the app, not core |
| `FEATURE_SIEM_EXPORT=true` | `SIEM_EXPORT_URL` (optional `SIEM_EXPORT_TOKEN`) | Warns if missing; export job no-ops |
| `FEATURE_OAUTH=true` | Provider credentials (`GITHUB_*`, `OIDC_*`) | See `.env.example` |
| `FEATURE_SAML=true` | `SAML_IDP_SSO_URL`, `SAML_IDP_CERT`, `SAML_SP_ENTITY_ID`, `SAML_ACS_URL`, `SAML_IDP_ISSUER` | Signed responses are required. Production boot rejects `SAML_WANT_RESPONSE_SIGNED=false`. Install `@node-saml/node-saml`. |

Keyring configuration is validated at boot and by `secrets:check`, including disabled-feature configurations. Use the [reader-first rotation contract](ENCRYPTION-ROTATION.md#auth-configuration-and-reader-first-rollout); never replace a retained key or lookup key in place.

## Recommended (not all enforced at boot)

- `REDIS_URL` for cache, queue, and shared login throttle
- `JWT_SECRET` if you mint JWTs (otherwise JWT falls back to `SESSION_SECRET`)
- `TRUST_FORWARDED_FOR=true` when a trusted reverse proxy sets `X-Forwarded-For`. Without it the socket peer is the client, which behind a proxy is the proxy itself, so every request shares one throttle bucket. With it, the rightmost public hop is used, so a client cannot pick its own key by prepending addresses.
- `TENANCY_DRIVER` must be exactly `none`, `column`, or `rls`; unknown values refuse to boot instead of silently enabling rls
- Generated apps ship a production `Dockerfile` (`APP_ENV=production`, `AUTH_DEV_HEADERS=false`, non-root user, `HEALTHCHECK`). `createHealthRoutes` without `pingOnHealth` is always 200 JSON and does not read notes. HiroApp `/health` is `schemaReady` (empty notes 200, unreadable not 200). Generated apps overwrite `/health` the same way. Docker HEALTHCHECK fetches `/health`. Run `bun run db:migrate` as a deploy step if the table does not exist yet
- `METRICS_TOKEN` to authorize `GET /metrics` (production hides the endpoint unless this is set)
- Multipart uploads are rejected unless the declared content type is on the allowlist. A missing content type and `application/octet-stream` are rejected too, because the client picks that value. Set `UPLOAD_ALLOW_UNKNOWN_MIME=true` only if you accept uploads from clients that cannot label them, and pair it with your own content inspection
- `TENANCY_DRIVER=rls` emits FORCE RLS policies. They apply to roles without `BYPASSRLS`. Generated Compose still has a `postgres` superuser for volume init, GRANT, migrate, `migrate:fresh` DROP, and Adminer. Runtime `DATABASE_URL` uses `strata_app` (`NOBYPASSRLS`), including `--no-docker`. Every rls runtime pool, including local, rejects username `postgres` or `root` on the runtime URL (`APP_DATABASE_URL` when set, otherwise `DATABASE_URL`), then inspects live `pg_roles`. Fixture `DATABASE_URL` may stay fixture admin. Username `postgres`/`root` is the fast path. Named superuser (`deploy`) is the live inspect. The HiroApp e2e denylist test is the postgres URL fast path. The live inspect e2e is `assertRlsLiveDatabaseRole()` on the `strata_app` pool. `assertProductionSecrets()` stays production-only. Production Compose `app`/`worker` runtime URLs are `strata_app` after the split (`STRATA_APP_PASSWORD` required). `MIGRATION_DATABASE_URL` stays the Compose superuser. Release `validate:ci` uses the same compose URLs as CI (`APP_DATABASE_URL=strata_app` on `127.0.0.1:54329`). Prod compose file test plus HiroApp live-role e2e. This CI does not compose-up `docker-compose.prod.yml`.
- `TENANCY_DRIVER=none` for apps without a `tenant` table. HiroApp keeps `rls`
- Unhandled exceptions return `500 {"error":"Internal server error."}` and are logged with their stack; driver constraint violations map to 409/422/400 with fixed messages on Postgres, MySQL, and SQLite
- `postgresAdminUrls()` tries `MIGRATION_DATABASE_URL`, then `postgres` with `dev-postgres-change-me` on the runtime host, then password `postgres` only when `APP_ENV` is local. That last URL is admin fallback only, not HiroApp HTTP.
- GRANT ALL TABLES in `scripts/postgres-init/01-hiroapp-test.sql` is `POSTGRES_DB` (`bun_testing_test`), not `hiroapp_test`. `hiroapp_test` GRANTs are `ensurePostgresDatabaseAndAppRole` after migrate. HiroApp HTTP uses `APP_DATABASE_URL`. Fixture `DATABASE_URL` is fixture admin for `bun_testing_test`. e2e `getSql()` `current_user` is a HiroApp probe, not the framework control. The `strata_app_e2e` probe is HiroApp-only.
- `127.0.0.1:54329` / `6379` / `33061` stay published. Adminer is debug-profile only. Generated Postgres `DATABASE_URL` is `strata_app` including `--no-docker`. Generated MySQL is still `mysql://root:…`.

## Deployment docs

- [DEPLOY.md](../DEPLOY.md)
- [RUNBOOK.md](../RUNBOOK.md)
- [INTEGRATIONS.md](./INTEGRATIONS.md)

## HTTP metrics in 2.0

HTTP durations use cumulative millisecond histogram buckets, count, and sum; no request samples are retained. `applyMiddlewareToRoutes()` and `createWebServer()` carry the registered template through request context, so `/orders/:slug` has one path label regardless of the shopper's slug. Unknown paths use `__unmatched__`. Query strings and request headers never become metric labels. Custom dispatchers must establish a trusted registered `routeTemplate` through `runWithRequestMeta()` or accept the unmatched label; never use a raw request URL as the template.

The registry admits at most 4,096 method/path/status series plus one aggregate overflow series. It normalizes methods and status codes, caps path label length, and escapes Prometheus label values. `new PrometheusRegistry(maxSeries)` can select a smaller positive limit; `getStorageStats()` exposes the retained series and bucket counts. Overflow preserves request/duration totals but loses the individual route and status breakdown. Scrape work is proportional to this cap and the fixed bucket count, rather than request volume. Alert on the overflow series before relying on per-route dashboards. Non-finite or negative duration observations are rejected.

The 1.x `normalizeMetricPath()` numeric/UUID heuristic is removed in 2.0. It could retain unlimited slug labels and cannot reliably infer route identity. Keep registered templates, including HTML routes, separate from the API-only OpenAPI registry.

## Distributed throttle availability

The 2.0 Redis API and login throttles consume an attempt and establish its expiry in one single-key Lua operation. A counter without a TTL is repaired in that same operation. Buckets use the application namespace, configured scope, tenant identity, HTTP method, registered route template, and caller identity. Slugs and query strings cannot bypass a route's limit. Login email is normalized before identity selection. Raw emails, tokens, and request paths are not stored in the key.

A configured Redis throttle returns JSON `503` with `Retry-After: 1` when Redis fails, responds incorrectly, or exceeds `commandTimeoutMs` (default 1,000ms). It does not call the business handler or switch to memory. A failed owned connection is closed and recreated on the next request. Applications can inject a shared `redisClient`; its lifecycle and recovery belong to that application. A timed-out attempt can still be consumed at the server; callers denied admission must retry normally. Handler errors propagate through the normal framework error contract.

Bucket keys change in 2.0, so existing throttle windows restart during migration. Retire old throttle keys separately during maintenance using bounded Redis SCAN; do not use KEYS. Unmatched dispatchers share a bucket. Custom dispatchers should carry trusted registered templates through request context as described above.

### Application-owned quotas

Core does not interpret plan names or apply plan multipliers. `TenantContext` contains identity, optional trusted `metadata` and opaque application extensions. Populate entitlement metadata through the application's trusted tenant resolver; do not derive it from arbitrary request headers.

Register `CORE_THROTTLE_QUOTA_POLICY_TOKEN` from `@getstrata/core/contracts/serviceTokens` during provider registration, before API middleware is composed:

```ts
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { CORE_THROTTLE_QUOTA_POLICY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import type { ThrottleQuotaPolicy } from "@getstrata/core/http/throttleMiddleware";

const quotaPolicy: ThrottleQuotaPolicy = ({ tenant, maxAttempts }) => {
  const allowance = tenant?.metadata?.apiAttemptsPerWindow;
  return typeof allowance === "number" ? allowance : maxAttempts;
};

export const quotaProvider: ServiceProvider = {
  name: "app.quotas",
  register({ container }) {
    container.set(CORE_THROTTLE_QUOTA_POLICY_TOKEN, quotaPolicy);
  },
};
```

Add this provider to the application's provider list. The generated HTTP kernel injects it into API Redis or memory throttles. Direct middleware construction accepts the same `quotaPolicy` option. The callback receives the request, current tenant, caller identity, registered route template and configured base limit. It is synchronous and changes only the attempt limit, not the fixed window (60 seconds for the generated API group). Without a policy, the configured base limit applies to all plans. Core does not fetch billing state or infer entitlements.

Return a nonnegative safe integer. Zero blocks the first attempt with 429 when the store is available. Thrown errors, promises and invalid limits produce controlled 503 without calling the business handler; a generous allowance cannot bypass a Redis failure. Resolve required entitlement data before throttling and keep the policy cheap. The policy does not replace dedicated login or SCIM limits. Routes also wrapped in the API group remain subject to its policy; the tenant can be null before protocol authentication, so provide a safe base allowance. See [tenancy](TENANCY.md) for trusted resolution and [typed providers](BUILDING-APPS.md#typed-service-tokens-and-narrow-controller-dependencies).

### Bounded local throttle storage

API, login and SCIM memory throttles use bounded, per-middleware-instance storage. `maxBuckets` defaults to 10,000 (supported range 1–1,000,000); `pruneBatchSize` defaults to 32 (range 1–1,024). Both must be safe integers. Windows use a monotonic clock and hits do not extend expiry. Each attempt prunes at most the configured batch of oldest expired entries and can separately replace its own expired bucket. There is no background timer or full-map scan per request.

A saturated store refuses a new identity with controlled 503 instead of evicting a live lockout. Existing identities keep their windows and limits. Direct constructors accept the storage options and expose `stats()` with retained bucket count, last-consume pruning count and disposal state. `dispose()` clears retained entries and denies future consumption. The HTTP kernel owns constructed throttles; generated context cleanup disposes them. Custom kernels and standalone middleware must retain and dispose their owners. Budget aggregate memory across middleware instances; the cap is not an application-wide byte budget.

These mechanisms were implemented in [#108](https://github.com/EyK-26/strata/pull/108), [#110](https://github.com/EyK-26/strata/pull/110) and [#111](https://github.com/EyK-26/strata/pull/111). Memory throttles remain process-local and are not a distributed production substitute. Configure Redis for shared enforcement; no memory fallback occurs when a configured Redis store fails.

## OpenTelemetry tracing

HTTP tracing uses the maintained SDK with W3C propagation, bounded batching, configured sampling and lifecycle flushing. Registered templates bound route names; request secrets and exception text are omitted. See [TRACING.md](TRACING.md) for collector trust, overflow behavior, configuration, manual instrumentation and Bun qualification.

## Scheduler ownership

Production due-task runners require Redis coordination by default. Stable task names, shared namespaces and renewable occurrence/overlap leases prevent duplicate admission while ownership is valid. Effects still require application idempotency; leases do not provide database fencing or automatic catch-up. See [SCHEDULER.md](SCHEDULER.md) for retention, configuration, failover and explicit single-runner operation.


### Generated readiness probes

Generated apps register `/health` in bootstrap with `createHealthRoutes`, `pingOnHealth: true`, `healthFormat: "text"`, and a non-mutating `schemaCheck`. It returns only `ok` (200) or `degraded` (503), with no authentication, tenant selection, RLS bypass, or business data. Database, configured Redis, and schema readability must succeed; zero visible rows is healthy. `/ready` checks dependencies only and can succeed before migrations. Use `/health` for readiness, and a separate process/TCP check for liveness so dependency outages do not cause restart loops. Restrict infrastructure probes at the network boundary when needed.

Existing generated apps must adopt the bootstrap health registration and remove their site-module `/health` handler; otherwise the module handler overrides the infrastructure probe and applies API admission middleware. Preserve any application-specific schema checks in the bootstrap callback using the runtime role. No database migration is needed for this change.


### CLI child shutdown and containers

The CLI relays SIGINT/SIGTERM to the server/run/dev child, waits for its completion, preserves its exit code, and removes only its own listeners. The child owns admission, draining, flushing and infrastructure shutdown through its lifecycle coordinator. Scheduled and queue/outbox commands retain their own lifecycle ownership.

Generated images invoke the official local CLI directly with `CMD ["bun", "./node_modules/.bin/strata", "start"]`. Adopt this launcher alongside the CLI update instead of layering `bun run start` above the supervisor; signals must reach the process that owns the child. Keep the platform termination grace longer than the framework shutdown deadline. Test SIGTERM on the deployed Linux/Bun image, including active work, before promotion.
