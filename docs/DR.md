# Disaster recovery

Adapt this checklist to your generated application and deployment. The framework repository does not run a product server. Times are operational targets, not promises.

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

- Run your application’s HTTP smoke and business reconciliation checks against the DR URL. The framework `bun run smoke` provisions isolated acceptance infrastructure; it does not probe your deployment.
- Sign in with a deliberately provisioned operational test account and a scoped token client; never use published demo credentials in production.
- Confirm HTML home `/` and `GET /health` still load
- If you enabled SIEM export, confirm the export job still returns JSON

## Phase 4. Post-incident

- Rotate tokens if the outage involved a leak
- Write down what broke
- Quarterly drills: restore a backup into a scratch database and boot your application against it

See [PRODUCTION.md](./PRODUCTION.md) and [RUNBOOK.md](../RUNBOOK.md).
