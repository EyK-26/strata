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
| `AUTH_DEV_HEADERS=false` | Always in production. `GuestGuard` is always null when `isProductionEnv()` is true, including staging, even if this flag is `true`. Local `AUTH_DEV_HEADERS=true` still reads request headers. |
| Identity response headers | Never set. `x-authenticated-user-id`, `x-tenant-id`, and `x-tenant-region` are not written on responses. |
| `DATABASE_URL` | Always at runtime. When `TENANCY_DRIVER=rls`, every rls runtime pool (including local) rejects username `postgres` or `root`, then inspects live `pg_roles` for `rolsuper` / `rolbypassrls`. The check inspects `APP_DATABASE_URL` if set, else `DATABASE_URL`. It never inspects `MIGRATION_DATABASE_URL`. Generated and HiroApp runtime URLs use `strata_app`. `MIGRATION_DATABASE_URL` may stay the superuser for CREATE ROLE / GRANT / migrate. `hiroapp-team` is `TENANCY_DRIVER=none` and does not run this check. |
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
| `FEATURE_SAML=true` | `SAML_IDP_SSO_URL`, `SAML_IDP_CERT`, `SAML_SP_ENTITY_ID`, `SAML_ACS_URL`, `SAML_IDP_ISSUER` | Signed responses are required. Production boot rejects `SAML_WANT_RESPONSE_SIGNED=false`. Install `@node-saml/node-saml`. |

## Recommended (not all enforced at boot)

- `REDIS_URL` for cache, queue, and shared login throttle
- `JWT_SECRET` if you mint JWTs (otherwise JWT falls back to `SESSION_SECRET`)
- `TRUST_FORWARDED_FOR=true` when a trusted reverse proxy sets `X-Forwarded-For`. Without it the socket peer is the client, which behind a proxy is the proxy itself, so every request shares one throttle bucket. With it, the rightmost public hop is used, so a client cannot pick its own key by prepending addresses.
- `TENANCY_DRIVER` must be exactly `none`, `column`, or `rls`; unknown values refuse to boot instead of silently enabling rls
- Generated apps ship a production `Dockerfile` (`APP_ENV=production`, `AUTH_DEV_HEADERS=false`, non-root user, `HEALTHCHECK`). `createHealthRoutes` without `pingOnHealth` is always 200 JSON and does not read notes. HiroApp `/health` is `schemaReady` (empty notes 200, unreadable not 200). Generated apps overwrite `/health` the same way. Docker HEALTHCHECK fetches `/health`. Run `bun run db:migrate` as a deploy step if the table does not exist yet
- `METRICS_TOKEN` to authorize `GET /metrics` (production hides the endpoint unless this is set)
- Multipart uploads are rejected unless the declared content type is on the allowlist. A missing content type and `application/octet-stream` are rejected too, because the client picks that value. Set `UPLOAD_ALLOW_UNKNOWN_MIME=true` only if you accept uploads from clients that cannot label them, and pair it with your own content inspection
- `TENANCY_DRIVER=rls` emits FORCE RLS policies. They apply to roles without `BYPASSRLS`. Generated Compose still has a `postgres` superuser for volume init, GRANT, migrate, `migrate:fresh` DROP, and Adminer. Runtime `DATABASE_URL` uses `strata_app` (`NOBYPASSRLS`), including `--no-docker`. Every rls runtime pool, including local, rejects username `postgres` or `root`, then inspects live `pg_roles`. Username `postgres`/`root` is the fast path. Named superuser (`deploy`) is the live inspect. The HiroApp e2e denylist test is the postgres URL fast path. The live inspect e2e is `assertRlsLiveDatabaseRole()` on the `strata_app` pool. `assertProductionSecrets()` stays production-only. Production Compose `app`/`worker` runtime URLs are `strata_app` after the split (`STRATA_APP_PASSWORD` required). `MIGRATION_DATABASE_URL` stays the Compose superuser. Prod compose file test plus HiroApp live-role e2e. This CI does not compose-up `docker-compose.prod.yml`.
- `TENANCY_DRIVER=none` for apps without a `tenant` table. HiroApp keeps `rls`
- Unhandled exceptions return `500 {"error":"Internal server error."}` and are logged with their stack; driver constraint violations map to 409/422/400 with fixed messages on Postgres, MySQL, and SQLite
- `postgresAdminUrls()` tries `MIGRATION_DATABASE_URL`, then `postgres` with `dev-postgres-change-me` on the runtime host, then password `postgres` only when `APP_ENV` is local. That last URL is admin fallback only, not HiroApp HTTP.
- GRANT ALL TABLES in `scripts/postgres-init/01-hiroapp-test.sql` is `POSTGRES_DB` (`bun_testing_test`), not `hiroapp_test`. `hiroapp_test` GRANTs are `ensurePostgresDatabaseAndAppRole` after migrate. HiroApp HTTP uses `APP_DATABASE_URL`. Fixture `DATABASE_URL` is fixture admin for `bun_testing_test`. e2e `getSql()` `current_user` is a HiroApp probe, not the framework control. The `strata_app_e2e` probe is HiroApp-only.
- `127.0.0.1:54329` / `6379` / `33061` stay published. Adminer is debug-profile only. Generated Postgres `DATABASE_URL` is `strata_app` including `--no-docker`. Generated MySQL is still `mysql://root:…`.

## Deployment docs

- [DEPLOY.md](../DEPLOY.md)
- [RUNBOOK.md](../RUNBOOK.md)
- [INTEGRATIONS.md](./INTEGRATIONS.md)
