# Production readiness

WorkHub blocks `APP_ENV=production` HTTP and queue workers when unsafe defaults are detected (`assertProductionSecrets` from `App.serve()` and `queue:work`). `createAppContext()` does not run that gate so sibling apps can boot without WorkHub tokens. Use this checklist before going live.

## Quick validation

Simulate production checks against your current shell environment (or `.env`):

```bash
# Must pass with production-like env — expect failures until vars are rotated
APP_ENV=production strata secrets:check
```

Fix every error until the command prints `Production secret checks passed`.

## Required for all production deployments

| Variable | When |
|----------|------|
| `APP_ENV=production` | Always |
| `APP_DEBUG=false` | Always (recommended) |
| `AUTH_DEV_HEADERS=false` | Always in production |
| `SESSION_SECRET` (32+ chars) | `FRONTEND_MODE=server-htmx` |
| `ADMIN_API_TOKEN`, `MEMBER_API_TOKEN` | Token auth enabled (`ADMIN_API_TOKEN` / `MEMBER_API_TOKEN` / `FEATURE_API_TOKENS=true`) — rotate away from WorkHub test defaults |
| `TOKEN_HASH_PEPPER` | Token auth enabled |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Token auth enabled |
| `OAUTH_STATE_SECRET` | OAuth / OIDC / SAML enabled (`FEATURE_OAUTH`, `FEATURE_SAML`, or provider env) |
| `CORS_ALLOWED_ORIGINS` | Token-auth WorkHub apps, or when `CORS_ALLOWED_ORIGINS` is set (no `*`) |
| `FEATURE_PUBLIC_READS=false` | WorkHub / token-auth apps, or when `FEATURE_PUBLIC_READS=true` is set |

A production HTMX sibling app needs `DATABASE_URL`, `SESSION_SECRET`, and `AUTH_DEV_HEADERS=false`. It does not need WorkHub API tokens, SCIM, OAuth, or CORS when those features are off.

WorkHub’s current production env (rotated `ADMIN_API_TOKEN` / `MEMBER_API_TOKEN` / `SCIM_BEARER_TOKEN`, explicit CORS, pepper, expiry, public reads off) still passes. See [SIBLING-HTMX.md](./SIBLING-HTMX.md).

## Enterprise modules (when enabled)

See [INTEGRATIONS.md](./INTEGRATIONS.md) for wiring details.

| Feature flag | Required env | Notes |
|--------------|--------------|-------|
| `FEATURE_FIELD_ENCRYPTION=true` | `KMS_ENCRYPTION_KEY` (32-byte hex or base64) | Email and sensitive fields |
| `FEATURE_SCIM=true` | `SCIM_BEARER_TOKEN` (rotated) | Optional `SCIM_TENANT_TOKENS` per tenant |
| `FEATURE_BILLING=true` | `STRIPE_WEBHOOK_SECRET` | Live Stripe SDK is app-specific — see integrations doc |
| `FEATURE_SIEM_EXPORT=true` | `SIEM_EXPORT_URL` (+ optional `SIEM_EXPORT_TOKEN`) | Warns if missing; export job no-ops |
| `FEATURE_OAUTH=true` | Provider credentials (`GITHUB_*`, `OIDC_*`, etc.) | See `.env.example` |
| `FEATURE_SAML=true` | `SAML_LOGIN_URL` + IdP metadata in your adapter | Stub redirect only in repo |

## Recommended (not enforced by startup guard)

- `REDIS_URL` for cache, queue, and rate limiting
- `TRUST_FORWARDED_FOR=true` only when a trusted reverse proxy sets `X-Forwarded-For` / `X-Real-IP` (`@getstrata/core/http/clientIp`)
- `METRICS_TOKEN` to authorize `GET /metrics` (production hides the endpoint unless this is set)
- `TENANCY_DRIVER=none` for apps without a `tenant` table (`@getstrata/core/tenant/tenancyConfig`; WorkHub keeps the default `rls`)
- `OTEL_EXPORTER_OTLP_ENDPOINT` for tracing
- Off-site database backups — see [DR.md](./DR.md)

## Deployment docs

- [DEPLOY.md](../DEPLOY.md) — environment and process layout
- [RUNBOOK.md](../RUNBOOK.md) — operations
- [INTEGRATIONS.md](./INTEGRATIONS.md) — SCIM, Stripe, SIEM, OAuth/SAML
