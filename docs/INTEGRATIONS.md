# Integrations

Strata ships hooks for SCIM, billing webhooks, SIEM export, and SSO. Core routes and jobs exist. Provider SDKs and IdP-specific behavior are yours to finish in small adapters in **your app**. Keep vendor SDKs out of `src/core/` when you can.

`create-strata` extras (`--scim`, `--mfa`, `--oauth-github`, `--billing`, `--webhooks`) are **off by default**. Cookie apps with those extras on also ship MFA pages, email verification, a SCIM `/Users` adapter, GitHub cookie login, a Stripe webhook stub, or outbound `webhook.dispatch`. Copy patterns from [AUTH.md](./AUTH.md) and [BUILDING-APPS.md](./BUILDING-APPS.md). Generated `.env.example` always includes commented `FEATURE_OAUTH` / `GITHUB_*` / `FEATURE_BILLING` / `STRIPE_WEBHOOK_SECRET` / `WEBHOOK_ALLOW_PRIVATE` blocks.

There is no `registerWebhookJobs()` API. Put a job class with `static jobName` in `src/jobs/` and call `discoverJobs()` (generated queue providers and `queue:work` already do). `--webhooks` writes `DispatchOutboundWebhookJob` as `webhook.dispatch`.

Production checklist: [PRODUCTION.md](./PRODUCTION.md)

Validate env: `APP_ENV=production bun run cli secrets:check`

## SCIM 2.0 (`FEATURE_SCIM=true`)

Set `SCIM_BEARER_TOKEN` to a long random secret (not `strata-scim-test-token`). Empty tokens are rejected. Optional multi-tenant tokens: `SCIM_TENANT_TOKENS=1:token-a,2:token-b`. The fallback bearer maps to tenant 1 and is platform-admin for that tenant only. Generated apps with `--scim` expose `/scim/v2/Users` and `/scim/v2/ServiceProviderConfig` and scope user SQL to `currentTenant().id` (throws if ALS is missing). `--tenancy=rls` FORCE RLS is on `users` as well as `notes`. Extend that module if you need Groups.

## Billing (`FEATURE_BILLING=true`)

Set `STRIPE_WEBHOOK_SECRET`. Signature verification lives in core (`verifyStripeWebhookSignature`). Plan sync and usage metering belong in an app module. `--billing` scaffolds `POST /billing/webhooks/stripe`, `GET /api/v1/billing/subscription`, and tables `subscription` / `stripe_webhook_event` (plus `tenant.stripe_customer_id` when tenancy is on). Put `tenant_id` (or equivalent) in Stripe metadata so you can map the event after verification.

Inbound Stripe POSTs have **no tenant ALS**. CSRF is skipped for `/billing/webhooks/`. Idempotency inserts into `stripe_webhook_event` and other billing tables must run inside `runWithMigrationBypass()` when `TENANCY_DRIVER=rls`, or the write sees an empty tenant and RLS returns no rows. Do not copy that unbounded helper onto user-facing routes; those use `runWithMigrationBypassForIdentifier` or the request tenant.

The Stripe Node SDK stays in your app, not `@getstrata/core`.

## Outbound webhooks

`--webhooks` creates `webhooks` / `webhook_deliveries`, a `notes.created` listener, and `src/jobs/dispatchOutboundWebhookJob.ts` (`static jobName = "webhook.dispatch"`). The job signs the JSON body with `signWebhookBody()` / `webhookSignatureHeader()` and POSTs through `safeFetch`.

Local receivers on private IPs need `WEBHOOK_ALLOW_PRIVATE=true` **and** a non-production `APP_ENV`. `allowPrivate: true` is ignored in production. Point the row `url` at an `https` host unless you also pass `allowHttp` in the job (the generated job allows HTTP only when `WEBHOOK_ALLOW_PRIVATE` is on locally).

## SIEM / audit export (`FEATURE_SIEM_EXPORT=true`)

1. Set `SIEM_EXPORT_URL` to an HTTP ingest endpoint that passes SSRF checks (no private IPs in production).
2. Optional `SIEM_EXPORT_TOKEN`.
3. The schedule task `export-audit-logs` pushes pending rows.

## GitHub OAuth / OIDC / SAML

`--oauth-github` (cookie HTML only) generates `GET /auth/github` and `GET /auth/github/callback`, a login link, and JIT user creation with the same MFA gate as SAML ACS. Set `FEATURE_OAUTH=true`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_REDIRECT_URI`. Production also wants `OAUTH_STATE_SECRET`. GitHub OAuth uses `safeFetch`, always reads `/user/emails`, and throws unless a verified address exists (no `{login}@users.noreply.github.com`, and an unverified `profile.email` is ignored).

OIDC `getAuthorizationUrl()` throws. Use `createAuthorization()` (async) and pass the handshake to `exchangeCode()`. There is **no generated OIDC cookie login**. Authorization, token, and JWKS URLs come from discovery. Inbound OIDC ID tokens are verified as RS256 via discovery JWKS (`iss` / `aud` / `azp` / `at_hash` / `exp` / `nbf` / `nonce`). App JWTs stay HS256. Multi-valued `aud` requires `azp` equal to the client id. `at_hash` is verified when present; omitted `access_token` plus `at_hash` throws. Missing or unverified email throws.

SAML is a real service provider (`SamlServiceProvider`); set `FEATURE_SAML=true` plus `SAML_IDP_SSO_URL`, `SAML_IDP_CERT`, `SAML_SP_ENTITY_ID`, `SAML_ACS_URL`, and `SAML_IDP_ISSUER`. Signed responses are required; production boot rejects `SAML_WANT_RESPONSE_SIGNED=false`. ACS verifies HMAC RelayState without a cookie and checks assertion issuer. Replay defaults to SQL `auth_saml_assertions`; tests may use in-memory. Both drop IDs after 1 hour. The old `saml:email:name` stub is gone. SAML ACS still challenges MFA when the user is already enrolled.

Outbound URL helpers resolve DNS, reject blocked answers, and fetch the resolved IP with the original Host and TLS server name. `allowPrivate: true` is ignored in production.

## System handlers without tenant ALS

Stripe webhooks, migration/seed, and similar workers are not inside a request `currentTenant()`. On `TENANCY_DRIVER=rls` that means `SELECT`/`INSERT` against tenant-scoped tables returns empty unless you:

1. `runWithMigrationBypass(async () => { ... })` for idempotency tables and other writes that have no user/tenant pin, or
2. `runWithMigrationBypassForIdentifier(id, ...)` when the table has an `app.bypass_identifier` policy (auth directory, sessions, tokens).

Smoke tests that POST a Stripe fixture and then `GET /api/v1/billing/subscription` without a tenant context will look "empty" even when the row exists. Wrap the apply path in bypass, then read under a real request tenant.

## Design rule

Keep vendor SDKs outside `src/core/`. Wrap them in `apps/<your-app>/src/modules/...` adapters so the framework stays usable without Stripe or a specific IdP.
