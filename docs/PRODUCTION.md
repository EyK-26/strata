# Production deployment

Use Bun >=1.4.4; generated apps pin the tested Bun 1.4.4 runtime. Qualify the actual Linux image, database service, Redis, mail provider, and ingress used by your deployment. Package checks do not certify a hosting provider or application configuration.

## Build and release

1. Commit application source and root/frontend lockfiles. Install from the lockfile and run application checks.
2. Build frontend assets when selected (`bun run frontend:install` and `bun run frontend:build`), or use the generated Docker build.
3. Back up data and confirm the release's schema changes are compatible with running HTTP processes and workers.
4. Run `bun run db:migrate` once as an explicit deployment step with migration credentials.
5. Start HTTP and required workers with runtime credentials; admit traffic after `/health` succeeds.

`strata start` does not migrate in production. Do not run fresh/reset commands or demo seeding against production. Provision the first administrator with the [initial-admin command](INITIAL-ADMIN.md).

The generated Dockerfile uses a non-root user and starts the local CLI directly. Build it from the generated app directory:

```bash
docker build -t my-app .
docker run --rm -p 3000:3000 --env-file .env.production my-app
```

Mount persistent storage for SQLite and local uploads. Generated Compose files and `.env.example` are development starting points; replace credentials and review network exposure before deployment. Keep databases, Redis, and administrative tools off public ingress.

## Environment and secrets

Set explicit deployment values; do not copy development secrets into production:

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_URL=https://app.example.com
AUTH_DEV_HEADERS=false
TENANT_DEV_HEADERS=false
FEATURE_PUBLIC_READS=false
```

Production checks also apply to staging, `NODE_ENV=production`, and unrecognized nonempty `APP_ENV` values. Generated application startup runs `assertProductionSecrets()`; check configuration before promotion from inside the app:

```bash
APP_ENV=production bunx strata secrets:check
```

The checks reject generated `change-me` placeholders, development header authentication, published test tokens, and unsafe enabled-feature settings. They are configuration checks, not a substitute for testing the deployed service.

| Configuration                                        | Required use                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                       | Runtime database; `APP_DATABASE_URL`, when set, overrides it for application execution.                                       |
| `SESSION_SECRET`                                     | Cookie authentication; use at least 32 characters. HTML modes enforce that minimum at production startup.                     |
| `SIGNED_URL_SECRET`                                  | Dedicated signing secret for generated account flows without cookie authentication. Follow the selected app's `.env.example`. |
| `TOKEN_HASH_PEPPER`, `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Opaque API token authentication; choose and enforce a positive expiry.                                                        |
| `JWT_SECRET`                                         | JWT authentication; configure a private signing secret for the selected auth stack.                                           |
| `OAUTH_STATE_SECRET`                                 | OAuth, OIDC, or SAML; configure provider credentials and callback URLs too.                                                   |
| `KMS_ENCRYPTION_KEY` or `KMS_ENCRYPTION_KEYRING`     | MFA or field encryption; preserve keys needed to read existing data.                                                          |
| `SCIM_BEARER_TOKEN`                                  | SCIM; configure per-tenant mappings with `SCIM_TENANT_TOKENS` when needed.                                                    |
| `STRIPE_WEBHOOK_SECRET`                              | Enabled billing webhooks.                                                                                                     |
| `METRICS_TOKEN`                                      | Production access to `/metrics`.                                                                                              |
| `REDIS_URL`                                          | Selected Redis cache, queue, or shared throttles.                                                                             |

Explicit encryption keyrings are validated even when encryption features are disabled. Plan reader compatibility before rotating keys, retain required old keys, and test restoration with the retained key material. SAML production responses must be signed. Unknown upload MIME types are rejected in production; retain the allowlist and inspect accepted content as needed. See [authentication](AUTH.md) and [integrations](INTEGRATIONS.md) for feature-specific configuration.

## Database identities

HTTP and workers should use a restricted runtime identity. Keep `MIGRATION_DATABASE_URL` and provisioning credentials in the administrative deployment process, targeting the same application database.

For PostgreSQL RLS, the runtime role must be non-owning, `NOSUPERUSER`, and `NOBYPASSRLS`. Runtime startup rejects `postgres`/`root` usernames and checks live role privileges, including outside production. Preserve `FORCE ROW LEVEL SECURITY`, generated policies, and transaction-local tenant context. Generated PostgreSQL runtime URLs use `strata_app`; replace its development password.

Generated MySQL examples currently use a development root URL. Provision a restricted application user and replace that URL before deployment; give a separate migration identity only the DDL privileges its migrations require. For SQLite, restrict filesystem access and use a supported consistent backup procedure.

Managed PostgreSQL services may allow schema migrations while restricting cluster-wide role provisioning. Qualify those operations separately; `CREATEROLE` alone does not authorize every provisioning operation. See [PostgreSQL provisioning](POSTGRES-PROVISIONING.md) and [tenancy](TENANCY.md).

## HTTPS, proxy trust, and CSRF

`APP_URL` selects public links and redirects; it does not change the request URL or establish proxy trust. Serve cookie authentication over HTTPS. Without an explicit CSRF target, cookie-form origin checks compare the browser's `Origin` with the request URL's origin; HTTPS termination with an HTTP upstream can therefore reject valid submissions.

For one public origin whose authority is preserved by ingress, explicitly configure:

```dotenv
APP_URL=https://app.example.com
CSRF_TARGET_ORIGIN=https://app.example.com
HOST=0.0.0.0
```

`CSRF_TARGET_ORIGIN` must be one HTTP(S) origin without credentials, a non-root path, query, fragment, or wildcard. Empty or invalid explicit values refuse kernel construction. Current generated configuration binds it before routes are assembled. Existing app-owned providers must deliberately register `CSRF_TARGET_ORIGIN_CONFIG_KEY` if they do not already do so.

With this policy, both request URL authority and the actual `Host` header must match the configured authority, including its port. Backend HTTP or HTTPS is allowed. Host admission runs on safe methods too, before token issuance and existing CSRF exemptions. It applies where that middleware runs; it is not a server-wide virtual-host firewall for health probes, static assets, or preflights.

Mutating cookie/anonymous requests still require a matching signed CSRF cookie/token and a valid browser `Origin` equal to the target. Missing/null/hostile origins and conflicting/missing hosts fail closed. Preserve the public authority at the proxy; forwarding headers cannot approve another origin. Multi-origin or host-rewriting deployments need an explicit application policy.

Keep backend access restricted and approve ingress hosts. A direct client with the approved Host/Origin and valid cookie/token can satisfy CSRF; this setting does not authenticate the proxy. Test form GET, cookie/token exchange, and POST through every ingress path, plus invalid tokens, hostile origins, unknown hosts, and direct-backend traffic.

Configure each trust mechanism separately:

- `CORS_ALLOWED_ORIGINS`: explicit browser origins; production rejects `*`. `CORS_ADDITIONAL_ALLOWED_HEADERS` extends allowed request-header names and does not grant CSRF exemptions.
- `TRUST_FORWARDED_FOR=true`: client-IP attribution for a trusted proxy's forwarded chain; it does not authorize origins or tenant hosts.
- Tenant `trustedProxyAddresses`: approved immediate socket peers for forwarded tenant-host selection; see [tenancy](TENANCY.md).
- `HOST`: TCP listen address only.

Public reads require deliberate admission. Generated apps default to authenticated reads; tenant-enabled public routes need trusted tenant resolution. The generated production mapping recognizes the configured `APP_URL` hostname as starter tenant 1; replace that mapping for the application's actual public tenants. See [native HTTP](NATIVE-HTTP.md) for request and response contracts.

## Readiness, workers, and shutdown

Generated `/health` returns plain `ok` (200) or `degraded` (503). It checks the database, configured Redis, and schema readability using the runtime identity, without authentication, tenant selection, RLS bypass, or application rows in the response. Zero visible rows is healthy.

`/ready` checks dependencies only and can succeed before migrations; `APP_DEBUG=false` keeps detailed diagnostics out of its response. Use `/health` as the deployment readiness gate and a separate process/TCP check for liveness, so dependency outages do not cause restart loops. Apply network restrictions to infrastructure probes when appropriate.

HTTP, Redis queue workers, and durable outbox workers are separate processes:

```bash
bun run start
bun run queue:work
bun run outbox:work
```

Run only workers the app needs. Outbox delivery requires migrations and registered listeners; Redis queue workers require matching transport configuration. Share application configuration, database, Redis namespace, and `APP_KEY_PREFIX` across the relevant processes. Idle polling is normal and is not evidence of dependency health.

Keep termination grace longer than `SHUTDOWN_TIMEOUT_MS` (generated default: 30 seconds). The CLI forwards SIGINT/SIGTERM; application lifecycle ownership stops admission, drains active work, flushes telemetry, and closes owned resources. Test SIGTERM with active requests and jobs on the deployed image. Coordinate code and schema rollback; restoring an older lockfile does not reverse database changes.

See [lifecycle](LIFECYCLE.md), [queues](QUEUES.md), and [scheduler ownership](SCHEDULER.md). Production scheduling uses Redis coordination by default; effects still require application idempotency, and leases do not supply database fencing or automatic catch-up.

## Operations and recovery

Use Redis for shared throttling across replicas. Memory limits are process-local. A configured Redis throttle fails closed with controlled 503 responses when its store is unavailable; it does not fall back to memory. Alert on sustained admission failures and dependency outages.

Monitor HTTP errors, latency, worker backlog/failures, and resource limits. Keep registered route templates in metrics and traces rather than raw paths or tenant identifiers; retain bounded telemetry and trusted collector configuration. See [runtime metrics](RUNTIME-METRICS.md) and [tracing](TRACING.md).

Back up the database, uploaded objects, encryption key material, and deployment configuration according to recovery objectives. Test restoration into an isolated environment, including encrypted data, tenant isolation, and pending job/outbox behavior. Reconcile external side effects before replaying work. A successful migration or backup command alone does not qualify restore, failover, provider permissions, or disaster recovery.
