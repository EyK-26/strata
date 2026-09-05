# Integrations

HiroApp exposes hooks for HRIS, billing, SIEM, and SSO. Core routes and jobs exist. Provider SDKs and IdP-specific behavior are yours to finish in small adapters. Keep vendor SDKs out of `src/core/` when you can.

Production checklist: [PRODUCTION.md](./PRODUCTION.md)

Validate env: `APP_ENV=production bun run cli secrets:check`

## SCIM 2.0 (`FEATURE_SCIM=true`)

Functional provisioning API (users plus org-as-groups). Filters and advanced IdP mappings are minimal. **Staff only.** Candidates are ignored.

| Endpoint | Notes |
|----------|-------|
| `GET /scim/v2/ServiceProviderConfig` | Capability discovery |
| `GET/POST /scim/v2/Users` | List/create users |
| `GET/PATCH/DELETE /scim/v2/Users/:id` | Manage users |
| `GET /scim/v2/Groups` | Organizations as SCIM groups |
| `PATCH /scim/v2/Groups/:id` | Add members via `members` patch op |

1. Set `SCIM_BEARER_TOKEN` to a long random secret (not `strata-scim-test-token`).
2. Optional multi-tenant tokens: `SCIM_TENANT_TOKENS=1:token-a,2:token-b`.
3. In your IdP, set SCIM base URL to `https://your-host/scim/v2`, bearer auth.
4. Extend `apps/hiroapp/src/modules/scim/service.ts` for deprovisioning and custom groups.

## Billing (`FEATURE_BILLING=true`)

Subscription table plus a Stripe webhook receiver (signature verification). Live Stripe SDK calls stay in the app.

| Endpoint | Notes |
|----------|-------|
| `GET /api/billing/subscription` | Current tenant subscription |
| `POST /api/billing/webhooks/stripe` | Webhook receiver |

Set `STRIPE_WEBHOOK_SECRET`. Plan sync and usage metering live in `apps/hiroapp/src/modules/billing/service.ts`.

## SIEM / audit export (`FEATURE_SIEM_EXPORT=true`)

1. Set `SIEM_EXPORT_URL` to an HTTP ingest endpoint that passes SSRF checks (no private IPs in production).
2. Optional `SIEM_EXPORT_TOKEN`.
3. Admins can also download `GET /api/audit-logs/export?format=json` or `format=cef`.
4. The schedule task `export-audit-logs` pushes pending rows.

## GitHub OAuth

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and register the callback `https://your-host/auth/oauth/github/callback`. Candidates who sign in this way get `role_id=2` unless the email already exists.

## OIDC (Azure AD, Okta, and similar)

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. Callback: `/auth/oauth/oidc/callback`.

## SAML

Set `SAML_LOGIN_URL`. In-repo behavior is a stub redirect. Put IdP XML parsing in an app adapter, not in `src/core/`.

## Mock SSO (local only)

`FEATURE_OAUTH_MOCK=true` adds `/auth/oauth/mock`. The callback creates `sso.candidate@hiroapp.com`. Never enable this in production.

## Partner API tokens

Create a token with ability `integrations:ping` and call `GET /api/integrations/ping`. That is the job-board heartbeat. Add more abilities in HiroApp when a real vendor needs them.

## Design rule

Keep vendor SDKs outside `src/core/`. Wrap them in `apps/hiroapp/src/modules/...` adapters so the framework stays usable without Stripe or a specific IdP.
