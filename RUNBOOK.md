# Operations Runbook

Quick reference for on-call and platform operators.

## Service overview

| Component | Port | Notes |
|-----------|------|-------|
| App (Bun) | 3000 | HTTP API + static index |
| PostgreSQL | 5432 | Primary data store |
| Redis | 6379 | Cache, queues, rate limits |
| Prometheus | 9090 | Optional monitoring overlay |
| Grafana | 3001 | Optional dashboards |

## Common incidents

### App returns 503 on `/ready`

1. Check PostgreSQL: `docker compose exec postgres pg_isready`
2. Check Redis: `docker compose exec redis redis-cli ping`
3. Review app logs: `docker compose logs app --tail=100`
4. Verify `DATABASE_URL` and `REDIS_URL` in the app container

### Rate limit spikes (429)

- Identify client via Redis keys prefixed `workhub:throttle:`
- Enterprise tenants (`x-tenant-id` with `plan=enterprise`) receive 4× the base limit
- Adjust `RATE_LIMIT_PER_MINUTE` if legitimate traffic is blocked

### Queue backlog

1. Confirm worker is running: `docker compose ps worker`
2. Inspect failed jobs: `bun run cli queue:failed`
3. Retry a job: `bun run cli queue:retry <id>`
4. High-priority jobs use Redis list `workhub:queue:high`

### Migration failure

Migrations use PostgreSQL advisory locks. If a migration hangs:

1. Check for stale connections holding the lock
2. Run `bun run cli migrate:status`
3. Never edit applied migration files — add a new migration instead

### Production startup blocked (secrets guard)

Error: *rotate ADMIN_API_TOKEN and MEMBER_API_TOKEN away from default WorkHub test values*

Set unique token values in environment before starting with `APP_ENV=production`.

## Deployment procedure

1. Take a backup: `./scripts/backup-db.sh`
2. Pull new image / rebuild: `docker compose build app`
3. Run migrations: `docker compose exec app bun run cli migrate`
4. Restart app and worker: `docker compose restart app worker`
5. Smoke test: `BASE_URL=https://your-host bun run smoke`
6. Watch `/metrics` and Grafana dashboards for error rate changes

## Rollback procedure

1. Restore previous container image
2. If schema changed, restore database from backup taken pre-deploy
3. Restart services and re-run smoke tests

## Security

- **Auth:** Bearer tokens only in staging/production (`AUTH_DEV_HEADERS=false`)
- **Headers:** CSP and HSTS enabled when `APP_ENV=production`
- **Audit:** Model writes emit audit log entries with IP, user-agent, and checksum
- **GDPR export:** `GET /api/v1/users/me/export` (authenticated)
- **Field encryption:** user emails encrypted at rest with `KMS_ENCRYPTION_KEY` in production
- **SCIM:** rotate `SCIM_BEARER_TOKEN`; provision via `/scim/v2/*`

## SCIM provisioning incidents

1. Verify IdP sends `Authorization: Bearer <SCIM_BEARER_TOKEN>`
2. Check app logs for `401` on `/scim/v2/Users`
3. Confirm newly provisioned users appear in `GET /scim/v2/Users`
4. Group membership changes use `PATCH /scim/v2/Groups/:id` with `members` operations

## Disaster recovery

Full procedures: [docs/DR.md](docs/DR.md)

| Target | Value |
|--------|-------|
| RPO | 1 hour |
| RTO | 4 hours |

**Quick failover:**

1. Promote DR Postgres / restore latest backup
2. Point `DATABASE_URL` and `REDIS_URL` to DR region
3. Redeploy app + worker
4. Update DNS to DR load balancer
5. Run `bun run smoke` and monitor `/metrics`

Quarterly DR drills are required — see checklist in `docs/DR.md`.

## Admin API

Requires token with `admin:read` ability (or `*`):

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/admin/stats` | Platform counts |
| `GET /api/v1/admin/tenants` | Tenant list with org counts |
| `GET /api/v1/admin/organization-members` | Membership roster |
| `GET /api/v1/admin/features` | Runtime feature flags |

## Observability

### Request tracing

Every response includes:

- `x-trace-id` — correlate logs across services
- `server-timing` — request duration (`app;dur=...`)
- `x-request-id` — per-request id
- `x-tenant-id` — resolved tenant

### Prometheus alerts

See `infra/prometheus/alerts.yml` for:

- High 5xx rate
- Readiness failures
- Elevated request latency

### Logs

Structured JSON request logs include method, path, status, duration, and trace id.

## Contacts and escalation

Document your team’s escalation path here (PagerDuty, Slack channel, etc.) when adopting this runbook internally.
