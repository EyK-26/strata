# Operations runbook

Quick reference for on-call.

## Service overview

| Component | Port | Notes |
|-----------|------|-------|
| App (Bun) | 3000 | HiroApp HTTP |
| PostgreSQL | 5432 in Compose, 54329 on host | Primary data store |
| Redis | 6379 | Cache, queues, rate limits |
| Prometheus | 9090 | Optional overlay |
| Grafana | 3001 | Optional dashboards |

## Common incidents

### App returns 503 on `/ready`

1. Check PostgreSQL: `docker compose exec postgres pg_isready`
2. Check Redis: `docker compose exec redis redis-cli ping`
3. Review app logs: `docker compose logs app --tail=100`
4. Verify `DATABASE_URL` and `REDIS_URL`

### Rate limit spikes (429)

- Identify client via Redis keys prefixed `${APP_KEY_PREFIX}:` (HiroApp: `hiroapp:`)
- Adjust `RATE_LIMIT_PER_MINUTE` or login throttle env if legitimate traffic is blocked

### Queue backlog

1. Confirm a worker is running
2. Inspect failed jobs: `bun run cli queue:failed`
3. Retry: `bun run cli queue:retry <id>`
4. High-priority jobs use Redis list `${APP_KEY_PREFIX}:queue:high`

### Migration failure

Migrations use PostgreSQL advisory locks. If a migration hangs:

1. Check for stale connections holding the lock
2. Run `bun run cli migrate:status`
3. Never edit applied migration files. Add a new migration instead.

### Production startup blocked (secrets guard)

Rotate `ADMIN_API_TOKEN`, `MEMBER_API_TOKEN`, and `SCIM_BEARER_TOKEN` away from published test defaults before `APP_ENV=production`.

## Deployment procedure

1. Take a backup: `./scripts/backup-db.sh`
2. Pull new image / rebuild: `docker compose build app`
3. Run migrations: `docker compose exec app bun run cli migrate`
4. Restart app and worker: `docker compose restart app worker`
5. Smoke test: `BASE_URL=https://your-host bun run smoke`
6. Watch `/metrics` for error rate changes

## Rollback

1. Restore the previous container image
2. If schema changed, restore the database from the pre-deploy backup
3. Restart services and re-run smoke tests

## Security

- Production: `AUTH_DEV_HEADERS=false`
- Headers: CSP and HSTS when `APP_ENV=production`
- Audit: model writes emit IP, user-agent, and checksum
- Field encryption: set `KMS_ENCRYPTION_KEY` when the flag is on
- SCIM: rotate `SCIM_BEARER_TOKEN`

## SCIM incidents

1. Verify the IdP sends `Authorization: Bearer <SCIM_BEARER_TOKEN>`
2. Check app logs for `401` on `/scim/v2/Users`
3. Confirm newly provisioned **users** appear in the `users` table (`POST /scim/v2/Users` on generated `--scim` apps).

## Tracing

- `x-trace-id`: correlate logs across services
- `server-timing`: request duration (`app;dur=...`)
- `x-request-id`: per-request id
- `x-tenant-id`: resolved tenant

## Disaster recovery

Quarterly DR drills are required. Checklist: [docs/DR.md](docs/DR.md).
