# Deployment Guide

This document covers deploying WorkHub to staging and production.

## Prerequisites

- Docker and Docker Compose
- PostgreSQL 18+ and Redis 7+
- Rotated secrets (never use default test tokens in production)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes (prod) | Redis for cache, queues, rate limiting |
| `APP_ENV` | Yes | `local`, `staging`, or `production` |
| `APP_DEBUG` | No | Set `false` in staging/production |
| `ADMIN_API_TOKEN` | Prod | Rotated admin seed token hash source |
| `MEMBER_API_TOKEN` | Prod | Rotated member seed token hash source |
| `AUTH_DEV_HEADERS` | No | Must be `false` in staging/production |
| `API_PREFIX` | No | Default `/api/v1` |
| `RATE_LIMIT_PER_MINUTE` | No | Base rate limit (plan multipliers apply) |
| `FEATURE_*` | No | Feature flags (`FEATURE_WEBHOOKS`, `FEATURE_AUDIT_LOG`, `FEATURE_ETAG`, etc.) |
| `FRONTEND_MODE` | No | `api` (default), `server-htmx`, or `spa-react` |
| `SESSION_SECRET` | Prod (server-htmx) | Signs encrypted session cookies; required when `FRONTEND_MODE=server-htmx` in production |
| `TRUST_FORWARDED_FOR` | No | Set `true` only behind a trusted proxy; otherwise `X-Forwarded-For` is ignored |
| `METRICS_TOKEN` | Prod | Bearer token for `GET /metrics`. Production returns 404 when unset |
| `OIDC_*` / `SAML_LOGIN_URL` | No | Enterprise SSO when enabled |
| `SCIM_BEARER_TOKEN` | Prod | SCIM provisioning bearer token (rotate from default) |
| `KMS_ENCRYPTION_KEY` | Prod | 32-byte hex/base64 key for email field encryption |
| `FEATURE_FIELD_ENCRYPTION` | No | Defaults on in production |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OpenTelemetry collector URL |
| `SIEM_EXPORT_URL` | Prod | Audit log SIEM forwarding endpoint |

Production startup refuses default `workhub-*-test-token` values and requires `KMS_ENCRYPTION_KEY` when field encryption is enabled. See `src/bootstrap/secretsGuard.ts`.

## Local development

```bash
docker compose up -d --wait
```

Migrations and seed run on container start.

## Staging

Use the staging overlay to disable dev auth headers and set `APP_ENV=staging`:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --wait
```

Verify readiness:

```bash
BASE_URL=http://localhost:3000 ADMIN_API_TOKEN=<your-token> bun run smoke
```

## Production

Use the production compose overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --wait
```

Recommended checklist:

1. Set strong `ADMIN_API_TOKEN` and `MEMBER_API_TOKEN` before first migrate/seed
2. Set `AUTH_DEV_HEADERS=false`
3. Set `APP_ENV=production` and `APP_DEBUG=false`
4. Configure `REDIS_URL` and run a queue worker (`bun run cli queue:work`)
5. Run migrations: `bun run cli migrate`
6. Run smoke tests against the deployed URL

## Monitoring stack

Prometheus and Grafana ship as an optional overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin/admin — change in production)
- App metrics: `GET /metrics` (set `METRICS_TOKEN` and scrape with `Authorization: Bearer <token>`)

Alert rules live in `infra/prometheus/alerts.yml`.

## Database backups

Create a backup (requires `pg_dump` and `DATABASE_URL`):

```bash
DATABASE_URL=postgres://... ./scripts/backup-db.sh
```

Restore:

```bash
DATABASE_URL=postgres://... ./scripts/restore-db.sh ./backups/workhub-<timestamp>.sql
```

Schedule daily backups via cron or your orchestrator.

## OpenAPI and SDK

Validate and publish the contract in CI or before release:

```bash
bun run cli openapi:validate   # writes docs/openapi.json
bun run cli sdk:generate       # writes generated TypeScript SDK
```

## Multi-tenancy

Authenticated users are scoped to their account tenant. Global admins may pass `x-tenant-id` to act as another tenant. Guests use tenant `1`; they can switch via `x-tenant-id` only when `FEATURE_PUBLIC_READS=true`.

See [docs/TENANCY.md](docs/TENANCY.md) for RLS tables and the auth-global `api_token` / `organization_member` decision.

Plan-based rate limits apply automatically (`free` 1×, `pro` 2×, `enterprise` 4×).

## Server-rendered frontend (cookie sessions)

When `FRONTEND_MODE=server-htmx`, the app serves Eta templates and HTML forms instead of JSON-only API responses for browser routes (`/login`, `/organizations`, etc.).

| Variable | Required | Description |
|----------|----------|-------------|
| `FRONTEND_MODE` | No | Set to `server-htmx` to enable the HTML/HTMX UI |
| `SESSION_SECRET` | Prod | 32+ character secret for signing session cookies. Startup fails in production when missing |
| `AUTH_DEV_HEADERS` | No | Must be `false` in staging/production |

**Authentication model**

- **API clients** continue to use `Authorization: Bearer <token>` on `/api/v1/*`.
- **Browser sessions** use an HTTP-only, signed cookie set by `POST /login` and cleared by `POST /logout`.
- Session cookies are scoped to the web routes; they do not replace bearer tokens for the JSON API.

**Production checklist (server-htmx)**

1. Set `FRONTEND_MODE=server-htmx`
2. Set a strong `SESSION_SECRET` (never commit or reuse dev values)
3. Set `AUTH_DEV_HEADERS=false`
4. Terminate TLS at your reverse proxy; cookies should only travel over HTTPS
5. Restart the app after changing `FRONTEND_MODE` or `SESSION_SECRET`

**SPA mode (`FRONTEND_MODE=spa-react`)**

1. Set `FRONTEND_MODE=spa-react`
2. Build the client: `cd frontend && bun install && bun run build`
3. Restart the API — static assets are served from `/app/*`
4. SPA auth uses `POST /api/v1/auth/login` and stores the bearer token in `localStorage`

Dev workflow: `cd frontend && bun run dev` (Vite proxies `/api` to the Bun server).

## Multi-instance deployment

When running **more than one app container** behind a load balancer:

| Concern | Requirement |
|---------|-------------|
| **Cache** | Set `CACHE_DRIVER=redis` and a shared `REDIS_URL` so tagged invalidation is visible to all instances |
| **Queues** | Set `QUEUE_DRIVER=redis` and run at least one `queue:work` worker |
| **Sessions (server-htmx)** | Cookie sessions are stateless (signed); any instance can verify `SESSION_SECRET` — no sticky sessions required |
| **SPA auth** | Bearer tokens are stateless; any instance can validate against the shared database |
| **Rate limits** | Prefer Redis-backed throttling (`REDIS_URL` set) so limits apply across instances |

Validate shared Redis cache:

```bash
docker compose run --rm -e REDIS_URL=redis://redis:6379 app bun test tests/integration/redisCache.integration.test.ts
```

Load test after deploy:

```bash
k6 run -e BASE_URL=https://your-host scripts/load/k6-api-load.js
```

See also `scripts/load/k6-smoke.js` for a lighter health-only check.

## Health probes

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness |
| `GET /ready` | Readiness (database + redis) |
| `GET /metrics` | Prometheus scrape target (Bearer `METRICS_TOKEN` in production) |

## Load testing

A k6 smoke script is provided for post-deploy verification:

```bash
k6 run scripts/load/k6-smoke.js
```

Set `BASE_URL` and `ADMIN_API_TOKEN` environment variables as needed.

## SCIM provisioning

Enterprise IdPs (Okta, Azure AD) can provision users and groups via SCIM 2.0:

| Endpoint | Description |
|----------|-------------|
| `GET /scim/v2/ServiceProviderConfig` | Capability discovery |
| `GET/POST /scim/v2/Users` | List/create users |
| `GET/PATCH/DELETE /scim/v2/Users/:id` | Manage users |
| `GET /scim/v2/Groups` | List organizations as groups |
| `PATCH /scim/v2/Groups/:id` | Add members to organizations |

Authenticate with `Authorization: Bearer <SCIM_BEARER_TOKEN>`.

SCIM ETags are enabled (`etag.supported: true`). Individual user and group resources return an `ETag` header on `GET`. `PATCH` and `DELETE` require a matching `If-Match` header (RFC 7232).

## Disaster recovery and multi-region

See [docs/DR.md](docs/DR.md) for RPO/RTO targets, failover steps, and tenant region routing (`tenant.region`: `eu`, `us`, `apac`).

## Security scanning

CI runs Trivy, Semgrep, `bun audit`, and `scripts/security-scan.sh`. Run locally:

```bash
sh scripts/security-scan.sh
```
