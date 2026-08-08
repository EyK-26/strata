# Integration Stubs

WorkHub ships **integration points** for enterprise services. Implementations are intentionally thin — wire your provider of choice via environment variables and extend the stub modules as needed.

## SCIM 2.0 (`FEATURE_SCIM=true`)

**Status:** Functional stub for user/group provisioning.

| Endpoint | Notes |
|----------|-------|
| `GET /scim/v2/ServiceProviderConfig` | Capability discovery |
| `GET/POST /scim/v2/Users` | List/create users |
| `GET/PATCH/DELETE /scim/v2/Users/:id` | Manage users |
| `GET /scim/v2/Groups` | Organizations as SCIM groups |
| `PATCH /scim/v2/Groups/:id` | Add members via `members` patch op |

**Auth:** `Authorization: Bearer <SCIM_BEARER_TOKEN>`

**Production:** Rotate `SCIM_BEARER_TOKEN` away from `workhub-scim-test-token`.

**Extend in:** `src/modules/scim/service.ts` — add filters, deprovisioning, group CRUD, IdP-specific mappings.

**IdP setup (Okta/Azure AD):** Point SCIM base URL to `https://your-host/scim/v2` with bearer token auth.

## Billing (`FEATURE_BILLING=true`)

**Status:** Subscription table + Stripe webhook **stub** (no live Stripe SDK).

| Endpoint | Notes |
|----------|-------|
| `GET /api/v1/billing/subscription` | Current tenant subscription |
| `POST /api/v1/billing/webhooks/stripe` | Webhook receiver stub |

**Extend in:**

- `src/modules/billing/service.ts` — plan sync, usage metering
- `src/core/billing/stripeClient.ts` — add when integrating Stripe SDK

**Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (document only; wire in your adapter).

## SIEM audit export

**Status:** Batch export job when `SIEM_EXPORT_URL` is set.

**Extend in:** `src/core/audit/exportAuditLogs.ts` — add Splunk HEC, Datadog, S3 batch adapters.

## OIDC / SAML

**Status:** OIDC provider registered when env vars set; SAML redirect stub when `FEATURE_SAML=true`.

**Extend in:** `src/core/auth/oauth/oidcProvider.ts`, `samlProvider.ts` — replace stubs with `@node-saml/node-saml` or your IdP SDK.

## Recommended integration pattern

1. Keep provider SDKs **outside** the framework core
2. Register adapters in module `provider.ts` `boot()` phase
3. Gate routes with `isFeatureEnabled()` in module `index.ts`
4. Document env vars in `.env.example` and `DEPLOY.md`
