# Disaster Recovery and Multi-Region Guide

This document defines recovery objectives, failover procedures, and multi-region routing for WorkHub.

## Recovery objectives

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (Recovery Point Objective) | 1 hour | Postgres PITR or hourly logical backups |
| **RTO** (Recovery Time Objective) | 4 hours | Restore DB, redeploy app tier, verify smoke tests |
| **Backup retention** | 30 days hot, 7 years cold archive | Align with compliance policy |

## Architecture overview

```text
                    ┌─────────────────┐
                    │  Global DNS /   │
                    │  Traffic Mgr    │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
     ┌─────────────────┐           ┌─────────────────┐
     │  Region: EU     │           │  Region: US     │
     │  (primary)      │           │  (DR standby)   │
     ├─────────────────┤           ├─────────────────┤
     │ App (stateless) │           │ App (cold/warm) │
     │ Redis           │           │ Redis replica   │
     │ Postgres primary│──repl──▶  │ Postgres standby│
     └─────────────────┘           └─────────────────┘
```

WorkHub is **stateless at the app layer**. Session and rate-limit state live in Redis; durable data lives in PostgreSQL.

## Multi-region tenant routing

Tenants may be pinned to a home region for data residency.

| Header | Purpose |
|--------|---------|
| `x-tenant-id` | Tenant scope (existing) |
| `x-region` | Request routing hint (`eu`, `us`) |

**Routing rules:**

1. Resolve tenant home region from the `tenant` table (`region` column when enabled).
2. If request arrives in a non-home region, return `307` with `x-target-region` or proxy internally.
3. EU tenants must not be served from US databases unless explicitly configured for DR read-only mode.

### Recommended schema extension

```sql
ALTER TABLE tenant ADD COLUMN region TEXT NOT NULL DEFAULT 'eu';
CREATE INDEX idx_tenant_region ON tenant(region);
```

## Backup strategy

### Automated backups

```bash
# Hourly cron (example)
0 * * * * DATABASE_URL=... BACKUP_DIR=/var/backups/workhub ./scripts/backup-db.sh
```

### Point-in-time recovery (managed Postgres)

When using RDS/Cloud SQL/Neon:

- Enable continuous archiving / PITR
- Test restore monthly into an isolated instance
- Record restore duration in the DR drill log

### Restore procedure

```bash
DATABASE_URL=postgres://... ./scripts/restore-db.sh ./backups/workhub-<timestamp>.sql
docker compose exec app bun run cli migrate:status
BASE_URL=https://dr.example.com bun run smoke
```

## Failover procedure (region loss)

### Phase 1 — Detect (0–15 min)

1. Confirm `/ready` failures across primary region load balancers
2. Check Prometheus alerts: `WorkHubReadinessFailure`, elevated 5xx
3. Declare incident and open DR bridge

### Phase 2 — Promote DR (15–120 min)

1. **Stop writes** to primary if split-brain risk exists
2. **Promote** Postgres standby in DR region (or restore latest backup)
3. **Point** `DATABASE_URL` and `REDIS_URL` in DR deployment to promoted services
4. **Deploy** app + worker containers in DR region
5. **Update DNS** / traffic manager to DR load balancer
6. **Rotate** secrets if primary compromise is suspected

### Phase 3 — Verify (120–240 min)

1. Run migrations: `bun run cli migrate`
2. Run smoke tests: `bun run smoke`
3. Validate SCIM, billing webhooks, and SIEM export endpoints
4. Monitor error rate and queue depth for 1 hour

### Phase 4 — Post-incident

1. Complete postmortem within 5 business days
2. Schedule fail-back window once primary region is healthy
3. Reconcile audit logs exported during DR window

## Fail-back procedure

1. Re-establish replication from DR → primary
2. Schedule maintenance window
3. Brief read-only mode
4. Sync final WAL/backup delta
5. Switch DNS back to primary
6. Keep DR warm standby online

## Quarterly DR drill checklist

- [ ] Restore latest backup to an isolated environment
- [ ] Run `bun run test:all` against restored database
- [ ] Run `bun run smoke` against restored stack
- [ ] Verify SIEM export replays without duplication
- [ ] Verify KMS-encrypted emails decrypt correctly with production key material
- [ ] Document actual RPO/RTO achieved
- [ ] Update this guide with lessons learned

## Multi-region deployment notes

| Concern | Guidance |
|---------|----------|
| Redis | Use region-local Redis; do not share across regions for rate limits |
| Queues | Workers consume from region-local Redis only |
| OTel / SIEM | Include `deployment.region` resource attribute |
| Secrets | Region-scoped secret stores (Vault/SSM paths per region) |
| SCIM | IdP redirect URLs must target active region endpoint |

## Communication templates

**Customer-facing (DR active):**

> We are operating from our disaster recovery site. API availability is restored; some analytics may be delayed.

**Internal:**

> DR declared at `<time>`. Primary region `<region>` unavailable. Promoted `<dr-region>`. RPO estimate: `<minutes>`. Owner: `<on-call>`.
