# Deployment Guide

This document covers deploying WorkHub (42 API) to staging and production.

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
| `FEATURE_*` | No | Feature flags (`FEATURE_WEBHOOKS`, `FEATURE_AUDIT_LOG`, etc.) |
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
- App metrics: `GET /metrics`

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

Pass `x-tenant-id` on API requests to scope organizations to a tenant. Default tenant id is `1`.

Plan-based rate limits apply automatically (`free` 1×, `pro` 2×, `enterprise` 4×).

## Health probes

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness |
| `GET /ready` | Readiness (database + redis) |
| `GET /metrics` | Prometheus scrape target |

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

## Disaster recovery and multi-region

See [docs/DR.md](docs/DR.md) for RPO/RTO targets, failover steps, and tenant region routing (`tenant.region`: `eu`, `us`, `apac`).

## Security scanning

CI runs Trivy, Semgrep, `bun audit`, and `scripts/security-scan.sh`. Run locally:

```bash
sh scripts/security-scan.sh
```
