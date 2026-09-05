# Disaster recovery

Use this when HiroApp or the database is down. Times are operational targets, not promises.

## Backups

- Postgres: `scripts/backup-db.sh` (or your host's managed backup)
- Store copies off-site
- Redis is cache and queue. Do not treat it as the system of record

## Phase 1. Detect (0 to 15 min)

- Check `/health` and `/ready`
- Grafana / Prometheus alerts (`infra/prometheus/alerts.yml`)
- Recent deploys and migration status: `strata migrate:status`

## Phase 2. Promote DR (15 to 120 min)

1. Point `DATABASE_URL` at the replica or restored snapshot
2. Run pending migrations if the snapshot is behind (`strata migrate`)
3. Restart the app and a queue worker (`strata start`, `strata queue:work`)
4. Confirm `SESSION_SECRET` and `JWT_SECRET` match the environment that issued cookies/tokens, or expect users to sign in again

## Phase 3. Verify (120 to 240 min)

- Smoke: `bun run smoke` against the DR URL
- Sign in as a recruiter (cookie) and as a token client (`GET /api/user`)
- Confirm careers list and one application still load
- Confirm audit export still returns JSON

## Phase 4. Post-incident

- Rotate tokens if the outage involved a leak
- Write down what broke
- Quarterly drills: restore a backup into a scratch database and boot HiroApp against it

See [PRODUCTION.md](./PRODUCTION.md) and [RUNBOOK.md](../RUNBOOK.md).
