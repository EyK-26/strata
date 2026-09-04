# Integration Stubs

HiroApp ships **integration points** for enterprise services. Core routes and jobs exist; **provider SDKs and IdP-specific behavior are yours to wire** via environment variables and small adapter extensions.

Production checklist: [PRODUCTION.md](./PRODUCTION.md)  
Validate env: `APP_ENV=production bun run cli secrets:check`

---

## SCIM 2.0 (`FEATURE_SCIM=true`)

**Status:** Functional provisioning API (users + org-as-groups). Filters and advanced IdP mappings are minimal.

| Endpoint | Notes |
|----------|-------|
| `GET /scim/v2/ServiceProviderConfig` | Capability discovery |
| `GET/POST /scim/v2/Users` | List/create users |
| `GET/PATCH/DELETE /scim/v2/Users/:id` | Manage users |
| `GET /scim/v2/Groups` | Organizations as SCIM groups |
| `PATCH /scim/v2/Groups/:id` | Add members via `members` patch op |

### Production setup

1. Set `SCIM_BEARER_TOKEN` to a long random secret (not `workhub-scim-test-token`).
2. Optional multi-tenant tokens: `SCIM_TENANT_TOKENS=1:token-a,2:token-b`.
3. In Okta / Azure AD / Google Workspace, set SCIM base URL to `https://your-host/scim/v2`, bearer auth.
4. Run `bun run cli secrets:check` with `APP_ENV=production`.

**Extend:** `apps/hiroapp/src/modules/scim/service.ts` — filters, deprovisioning, custom group CRUD. Staff only; candidates are ignored.

---

## Billing (`FEATURE_BILLING=true`)

**Status:** Subscription table + Stripe webhook **receiver** (signature verification). No live Stripe SDK calls in-repo.

| Endpoint | Notes |
|----------|-------|
| `GET /api/billing/subscription` | Current tenant subscription |
| `POST /api/billing/webhooks/stripe` | Webhook receiver |

### Production setup

1. Create a Stripe webhook endpoint pointing at `https://your-host/api/v1/billing/webhooks/stripe`.
2. Set `STRIPE_WEBHOOK_SECRET` from the Stripe dashboard (required in production when billing is enabled).
3. Set `STRIPE_SECRET_KEY` when you add a Stripe client adapter for checkout/portal (not included in core).
4. Map Stripe `customer` / subscription metadata to tenant IDs in your adapter.

**Extend:**

- `apps/hiroapp/src/modules/billing/service.ts` — plan sync, usage metering
- New `src/core/billing/stripeClient.ts` (or module-local adapter) — Stripe SDK

---

## SIEM audit export

**Status:** Scheduled batch export when `SIEM_EXPORT_URL` is set (`src/core/audit/exportAuditLogs.ts`).

### Production setup

1. Set `SIEM_EXPORT_URL` to your SIEM HTTP ingest endpoint (must pass SSRF checks — no private IPs in production).
2. Optional: `SIEM_EXPORT_TOKEN`, `SIEM_EXPORT_FORMAT=json|cef`, `SIEM_EXPORT_BATCH_SIZE`.
3. Enable `FEATURE_SIEM_EXPORT=true` (default in `.env.example`).
4. Scheduler runs `audit-export` every minute via `src/bootstrap/schedule.ts`.

**Extend:** Add Splunk HEC, Datadog, or S3 batch adapters alongside the JSON/CEF formatters.

---

## OIDC / OAuth / SAML

**Status:** GitHub OAuth works when `GITHUB_CLIENT_*` are set. OIDC issuer flow registers when `OIDC_*` env vars are present. SAML is a redirect stub when `FEATURE_SAML=true`.

### Production setup — GitHub OAuth

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
OAUTH_REDIRECT_URI=https://your-host/api/v1/auth/oauth/github/callback
OAUTH_STATE_SECRET=...   # required in production
```

Register the HTMX callback (`https://your-host/oauth/github/callback`) as an additional authorized redirect URI on the GitHub app. HiroApp sends that URI for `/oauth/:provider` and keeps `OAUTH_REDIRECT_URI` for the API bearer flow.

### Production setup — OIDC (Azure AD, Okta, etc.)

```env
OIDC_ISSUER=https://your-idp.example.com
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OAUTH_REDIRECT_URI=https://your-host/api/v1/auth/oauth/oidc/callback
```

### Production setup — SAML

1. Set `FEATURE_SAML=true` and `SAML_LOGIN_URL` (IdP entry point).
2. Replace stub in `src/core/auth/oauth/samlProvider.ts` with `@node-saml/node-saml` or your IdP SDK.
3. Add ACS/callback routes in the user module as needed.

**Extend:** `src/core/auth/oauth/oidcProvider.ts`, `samlProvider.ts`, `apps/hiroapp/src/modules/auth` (provider registration).

---

## Recommended integration pattern

1. Keep vendor SDKs **outside** `src/core/` where possible — wrap in module adapters.
2. Register adapters in module `provider.ts` `boot()` phase.
3. Gate routes with `isFeatureEnabled()` in module `index.ts`.
4. Document env vars in `.env.example`, [PRODUCTION.md](./PRODUCTION.md), and `DEPLOY.md`.
5. Add integration tests with mocked HTTP (see `apps/hiroapp/src/tests/enterprise.test.ts`, `tests/unit/exportAuditLogs.test.ts`).
