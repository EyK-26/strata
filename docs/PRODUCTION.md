# Production readiness

WorkHub blocks `APP_ENV=production` startup when unsafe defaults are detected (`src/bootstrap/secretsGuard.ts`). Use this checklist before going live.

## Quick validation

Simulate production checks against your current shell environment (or `.env`):

```bash
# Must pass with production-like env — expect failures until vars are rotated
APP_ENV=production bun run cli secrets:check
```

Fix every error until the command prints `Production secret checks passed`.

## Required for all production deployments

| Variable | Why |
|----------|-----|
| `APP_ENV=production` | Enables production guards |
| `APP_DEBUG=false` | Disables verbose errors |
| `AUTH_DEV_HEADERS=false` | Disables `x-user-id` dev auth |
| `ADMIN_API_TOKEN`, `MEMBER_API_TOKEN` | Rotated away from WorkHub test defaults |
| `TOKEN_HASH_PEPPER` | Pepper for API token hashing |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Enforces token rotation |
| `OAUTH_STATE_SECRET` | OAuth CSRF protection |
| `CORS_ALLOWED_ORIGINS` | Explicit origins (no `*`) |
| `FEATURE_PUBLIC_READS=false` | Authenticated reads only |
| `SESSION_SECRET` | Required when `FRONTEND_MODE=server-htmx` |

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
- `TRUST_FORWARDED_FOR=true` only when a trusted reverse proxy sets `X-Forwarded-For` / `X-Real-IP`
- `METRICS_TOKEN` to authorize `GET /metrics` (production hides the endpoint unless this is set)
- `OTEL_EXPORTER_OTLP_ENDPOINT` for tracing
- Off-site database backups — see [DR.md](./DR.md)

## Deployment docs

- [DEPLOY.md](../DEPLOY.md) — environment and process layout
- [RUNBOOK.md](../RUNBOOK.md) — operations
- [INTEGRATIONS.md](./INTEGRATIONS.md) — SCIM, Stripe, SIEM, OAuth/SAML
