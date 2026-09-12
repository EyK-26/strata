# Production readiness

`assertProductionSecrets()` runs when `isProductionEnv()` is true: `APP_ENV=production` or `NODE_ENV=production` (case-insensitive), `APP_ENV=staging`, or an unrecognized `APP_ENV` value. HiroApp and generated apps call it from `createApp()`. The check is feature-gated: flags that are off do not demand their secrets.

Validate:

```bash
APP_ENV=production strata secrets:check
```

Fix every error until it prints that production secret checks passed.

## Required for all production deployments

| Variable | When |
|----------|------|
| `APP_ENV=production` | Always |
| `APP_URL` | Always. The public origin (`https://...`); signed links and redirects are built from it. Localhost is rejected. |
| `APP_DEBUG=false` | Always (recommended) |
| `AUTH_DEV_HEADERS=false` | Always in production |
| `SESSION_SECRET` (32+ chars) | `FRONTEND_MODE=server-htmx` or `hybrid` |
| `ADMIN_API_TOKEN`, `MEMBER_API_TOKEN` | When those env vars are set or `FEATURE_API_TOKENS=true`. Rotate away from `strata-*-test-token` and any leftover published seed strings |
| `TOKEN_HASH_PEPPER` | Token auth enabled |
| `API_TOKEN_DEFAULT_EXPIRY_DAYS` | Token auth enabled |
| `OAUTH_STATE_SECRET` | OAuth / OIDC / SAML enabled |
| `CORS_ALLOWED_ORIGINS` | Only when browsers on other origins call the API. Unset is `APP_URL` locally and same-origin in production. Never defaults to `*`. `*` is rejected in production. |
| `FEATURE_PUBLIC_READS=false` | Required in production. The flag only controls whether anonymous `x-tenant-id` is honored. Guests already pin to tenant 1, so `/login` works with the default `false`. |

A production HTML app needs `DATABASE_URL`, `SESSION_SECRET`, and `AUTH_DEV_HEADERS=false`. It does not need API tokens, SCIM, OAuth, or CORS when those features are off.

## When a feature is on

See [INTEGRATIONS.md](./INTEGRATIONS.md).

| Feature flag | Required env | Notes |
|--------------|--------------|-------|
| `FEATURE_FIELD_ENCRYPTION=true` | `KMS_ENCRYPTION_KEY` (32-byte hex or base64) | Encrypted columns you opt into |
| `FEATURE_MFA=true` | `KMS_ENCRYPTION_KEY` (32-byte hex or base64) | Required to store TOTP secrets, including local/dogfood |
| `FEATURE_SCIM=true` | `SCIM_BEARER_TOKEN` (rotated) | Optional `SCIM_TENANT_TOKENS` per tenant |
| `FEATURE_BILLING=true` | `STRIPE_WEBHOOK_SECRET` | Stripe SDK stays in the app, not core |
| `FEATURE_SIEM_EXPORT=true` | `SIEM_EXPORT_URL` (optional `SIEM_EXPORT_TOKEN`) | Warns if missing; export job no-ops |
| `FEATURE_OAUTH=true` | Provider credentials (`GITHUB_*`, `OIDC_*`) | See `.env.example` |
| `FEATURE_SAML=true` | `SAML_IDP_SSO_URL`, `SAML_IDP_CERT`, `SAML_SP_ENTITY_ID`, `SAML_ACS_URL`, `SAML_IDP_ISSUER` | Signed responses default on (`SAML_WANT_RESPONSE_SIGNED=false` opts out). Install `@node-saml/node-saml`. |

## Recommended (not all enforced at boot)

- `REDIS_URL` for cache, queue, and shared login throttle
- `JWT_SECRET` if you mint JWTs (otherwise JWT falls back to `SESSION_SECRET`)
- `TRUST_FORWARDED_FOR=true` when a trusted reverse proxy sets `X-Forwarded-For`. Without it the socket peer is the client, which behind a proxy is the proxy itself, so every request shares one throttle bucket. With it, the rightmost public hop is used, so a client cannot pick its own key by prepending addresses.
- `TENANCY_DRIVER` must be exactly `none`, `column`, or `rls`; unknown values refuse to boot instead of silently enabling rls
- Generated apps ship a production `Dockerfile` (`APP_ENV=production`, `AUTH_DEV_HEADERS=false`, non-root user, `HEALTHCHECK`). `GET /health` answers 503 until a notes row is readable, so run `bun run db:migrate` as a deploy step
- `METRICS_TOKEN` to authorize `GET /metrics` (production hides the endpoint unless this is set)
- Multipart uploads are rejected unless the declared content type is on the allowlist. A missing content type and `application/octet-stream` are rejected too, because the client picks that value. Set `UPLOAD_ALLOW_UNKNOWN_MIME=true` only if you accept uploads from clients that cannot label them, and pair it with your own content inspection
- `TENANCY_DRIVER=none` for apps without a `tenant` table. HiroApp keeps `rls`
- Unhandled exceptions return `500 {"error":"Internal server error."}` and are logged with their stack; driver constraint violations map to 409/422/400 with fixed messages on Postgres, MySQL, and SQLite
- Off-site database backups: [DR.md](./DR.md)

## Deployment docs

- [DEPLOY.md](../DEPLOY.md)
- [RUNBOOK.md](../RUNBOOK.md)
- [INTEGRATIONS.md](./INTEGRATIONS.md)
