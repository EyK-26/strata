# Deployment

How to run HiroApp (or your Strata app) in staging and production.

## Prerequisites

- Docker and Docker Compose
- PostgreSQL 18+ and Redis 7+
- Rotated secrets (never use published test tokens in production)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes (prod) | Redis for cache, queues, shared rate limiting |
| `APP_ENV` | Yes | `local` or `production`. `staging` is treated as production for secret checks |
| `APP_DEBUG` | No | Set `false` in staging/production |
| `AUTH_DEV_HEADERS` | Staging and prod | Must be `false` |
| `API_PREFIX` | No | HiroApp uses `/api` |
| `FRONTEND_MODE` | No | `api`, `server-htmx`, `spa-react`, or `hybrid` |
| `SESSION_SECRET` | Staging and prod (HTML) | Signs cookie-session payloads. Required when views are on (`server-htmx` or `hybrid`) |
| `JWT_SECRET` | Staging and prod if you mint JWTs | HS256 key. Locally falls back to `SESSION_SECRET`. Staging and production do not derive it from the app name |
| `TRUST_FORWARDED_FOR` | No | Set `true` only behind a trusted proxy |
| `METRICS_TOKEN` | Prod | Bearer token for `GET /metrics`. Production returns 404 when unset |
| `SCIM_BEARER_TOKEN` | If SCIM on | Rotate from published test defaults |
| `KMS_ENCRYPTION_KEY` | If encryption on | 32-byte hex/base64 key |
| `SIEM_EXPORT_URL` | If SIEM on | Audit log HTTP ingest |

Production and staging startup refuse published seed tokens (`strata-*-test-token` and leftover historical strings). See `src/bootstrap/secretsGuard.ts` and [docs/PRODUCTION.md](docs/PRODUCTION.md).

## Local development

```bash
docker compose up -d postgres redis --wait
bun run build:framework
bun run hiroapp:fresh
bun run hiroapp:dev
```

See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

## Staging

`APP_ENV=staging` runs the same secret checks as production. Set `SESSION_SECRET`, `AUTH_DEV_HEADERS=false`, and any feature secrets before booting.

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --wait
```

```bash
BASE_URL=http://localhost:3000 bun run smoke
```

## Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --wait
```

Checklist:

1. Rotate API and SCIM tokens before first migrate/seed
2. `AUTH_DEV_HEADERS=false`
3. `APP_ENV=production` and `APP_DEBUG=false`
4. `REDIS_URL` plus a queue worker (`bun run cli queue:work`)
5. `bun run cli migrate`
6. Smoke tests against the deployed URL

## Monitoring

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (change `admin`/`admin` in production)
- App metrics: `GET /metrics` with `Authorization: Bearer <METRICS_TOKEN>`

Alert rules: `infra/prometheus/alerts.yml`.

## Database backups

```bash
DATABASE_URL=postgres://... ./scripts/backup-db.sh
```

Restore with your `restore-db.sh` (or `psql`) against a timestamped dump. See [docs/DR.md](docs/DR.md).

## OpenAPI

```bash
DOGFOOD_APP=hiroapp APP_KEY_PREFIX=hiroapp APP_NAME=HiroApp API_PREFIX=/api bun run cli openapi:generate
bun run cli openapi:check
```

## Multi-tenancy

Authenticated users are scoped to their account tenant. Global admins may pass `x-tenant-id`. Guests use tenant `1`. They can switch via `x-tenant-id` only when `FEATURE_PUBLIC_READS=true`. See [docs/TENANCY.md](docs/TENANCY.md).

## HTML cookie sessions (`FRONTEND_MODE=server-htmx` or `hybrid`)

HiroApp stores sessions in Postgres. Any instance can serve a request if it shares the database. Sticky sessions are not required.

| Client | Credential |
|--------|------------|
| Browser HTML | Cookie + CSRF |
| JSON with cookie | Cookie + `x-csrf-token` |
| SPA / partners | Opaque Bearer or JWT |
| Scripts | HTTP Basic over TLS |

Terminate TLS at the reverse proxy. Set `Secure` cookies in production (`APP_ENV=production`).

## Multi-instance

| Concern | Requirement |
|---------|-------------|
| Cache | `CACHE_DRIVER=redis` and a shared `REDIS_URL` |
| Queues | `QUEUE_DRIVER=redis` and at least one `queue:work` worker |
| Sessions | Shared Postgres `sessions` table (HiroApp) |
| Rate limits | Redis-backed throttle so limits apply across instances |

```bash
k6 run -e BASE_URL=https://your-host scripts/load/k6-api-load.js
```

The load script mints a JWT as `demo@example.com` and hits `/health`, `/ready`, and `/api/user`.

## Health probes

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness |
| `GET /ready` | Readiness (database + redis) |
| `GET /metrics` | Prometheus scrape (Bearer `METRICS_TOKEN` in production) |

## SCIM

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). Authenticate with `Authorization: Bearer <SCIM_BEARER_TOKEN>`.

## Security scanning

```bash
sh scripts/security-scan.sh
```
