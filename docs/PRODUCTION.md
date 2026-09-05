# Production readiness

`assertProductionSecrets()` runs when `APP_ENV=production`. HiroApp calls it from `createApp()`. The check is feature-gated: flags that are off do not demand their secrets.

Validate:

```bash
APP_ENV=production strata secrets:check
```

Fix every error until it prints that production secret checks passed.

## Required for all production deployments

| Variable | When |
|----------|------|
| `APP_ENV=production` | Always |
| `APP_DEBUG=false` | Always (recommended) |
| `AUTH_DEV_HEADERS=false` | Always in production |
| `SESSION_SECRET` (32+ chars) | `FRONTEND_MODE=server-htmx` or `hybrid` |
| `ADMIN_API_TOKEN`, `MEMBER_API_TOKEN` | When those env vars are set or `FEATURE_API_TOKENS=true`. Rotate away from `strata-*-test-token` and any leftover published seed strings |
| `TOKEN_HASH_PEPPER` | Token auth enabled |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Token auth enabled |
| `OAUTH_STATE_SECRET` | OAuth / OIDC / SAML enabled |
| `CORS_ALLOWED_ORIGINS` | If you set this variable, it must not include `*` |
| `FEATURE_PUBLIC_READS=false` | Unless you intentionally publish reads (HiroApp careers can keep public list routes without this flag meaning "open tenant probe") |

A production HTML app needs `DATABASE_URL`, `SESSION_SECRET`, and `AUTH_DEV_HEADERS=false`. It does not need API tokens, SCIM, OAuth, or CORS when those features are off.

## When a feature is on

See [INTEGRATIONS.md](./INTEGRATIONS.md).

| Feature flag | Required env | Notes |
|--------------|--------------|-------|
| `FEATURE_FIELD_ENCRYPTION=true` | `KMS_ENCRYPTION_KEY` (32-byte hex or base64) | Offer notes and similar fields |
| `FEATURE_SCIM=true` | `SCIM_BEARER_TOKEN` (rotated) | Optional `SCIM_TENANT_TOKENS` per tenant |
| `FEATURE_BILLING=true` | `STRIPE_WEBHOOK_SECRET` | Stripe SDK stays in the app, not core |
| `FEATURE_SIEM_EXPORT=true` | `SIEM_EXPORT_URL` (optional `SIEM_EXPORT_TOKEN`) | Warns if missing; export job no-ops |
| `FEATURE_OAUTH=true` | Provider credentials (`GITHUB_*`, `OIDC_*`) | See `.env.example` |
| `FEATURE_SAML=true` | `SAML_LOGIN_URL` plus IdP metadata in your adapter | |

## Recommended (not all enforced at boot)

- `REDIS_URL` for cache, queue, and shared login throttle
- `JWT_SECRET` if you mint JWTs (otherwise JWT falls back to `SESSION_SECRET`)
- `TRUST_FORWARDED_FOR=true` only when a trusted reverse proxy sets `X-Forwarded-For`
- `METRICS_TOKEN` to authorize `GET /metrics` (production hides the endpoint unless this is set)
- `TENANCY_DRIVER=none` for apps without a `tenant` table. HiroApp keeps `rls`
- Off-site database backups: [DR.md](./DR.md)

## Deployment docs

- [DEPLOY.md](../DEPLOY.md)
- [RUNBOOK.md](../RUNBOOK.md)
- [INTEGRATIONS.md](./INTEGRATIONS.md)
