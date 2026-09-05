# Integrations

Strata ships hooks for SCIM, billing webhooks, SIEM export, and SSO. Core routes and jobs exist. Provider SDKs and IdP-specific behavior are yours to finish in small adapters in **your app**. Keep vendor SDKs out of `src/core/` when you can.

The generated examples set env flags (`FEATURE_SCIM`, `FEATURE_MFA`, and similar). They do not ship a hiring-domain SCIM or Stripe module. Copy patterns from [AUTH.md](./AUTH.md) and [BUILDING-APPS.md](./BUILDING-APPS.md).

Production checklist: [PRODUCTION.md](./PRODUCTION.md)

Validate env: `APP_ENV=production bun run cli secrets:check`

## SCIM 2.0 (`FEATURE_SCIM=true`)

Set `SCIM_BEARER_TOKEN` to a long random secret (not `strata-scim-test-token`). Optional multi-tenant tokens: `SCIM_TENANT_TOKENS=1:token-a,2:token-b`. Put user and group adapters in your app modules.

## Billing (`FEATURE_BILLING=true`)

Set `STRIPE_WEBHOOK_SECRET`. Signature verification lives in core. Plan sync and usage metering belong in an app module.

## SIEM / audit export (`FEATURE_SIEM_EXPORT=true`)

1. Set `SIEM_EXPORT_URL` to an HTTP ingest endpoint that passes SSRF checks (no private IPs in production).
2. Optional `SIEM_EXPORT_TOKEN`.
3. The schedule task `export-audit-logs` pushes pending rows.

## GitHub OAuth / OIDC / SAML

Set the matching `GITHUB_*`, `OIDC_*`, or `SAML_LOGIN_URL` variables. Put IdP-specific parsing in an app adapter, not in `src/core/`.

## Design rule

Keep vendor SDKs outside `src/core/`. Wrap them in `apps/<your-app>/src/modules/...` adapters so the framework stays usable without Stripe or a specific IdP.
