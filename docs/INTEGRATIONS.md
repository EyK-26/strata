# Integrations

Strata ships hooks for SCIM, billing webhooks, SIEM export, and SSO. Core routes and jobs exist. Provider SDKs and IdP-specific behavior are yours to finish in small adapters in **your app**. Keep vendor SDKs out of `src/core/` when you can.

The generated examples set env flags (`FEATURE_SCIM`, `FEATURE_MFA`, and similar). Cookie apps with those extras on also ship MFA pages, email verification, and a SCIM `/Users` adapter against the `users` table. Copy patterns from [AUTH.md](./AUTH.md) and [BUILDING-APPS.md](./BUILDING-APPS.md).

Production checklist: [PRODUCTION.md](./PRODUCTION.md)

Validate env: `APP_ENV=production bun run cli secrets:check`

## SCIM 2.0 (`FEATURE_SCIM=true`)

Set `SCIM_BEARER_TOKEN` to a long random secret (not `strata-scim-test-token`). Empty tokens are rejected. Optional multi-tenant tokens: `SCIM_TENANT_TOKENS=1:token-a,2:token-b`. The fallback bearer maps to tenant 1 and is platform-admin for that tenant only. Generated apps with `--scim` expose `/scim/v2/Users` and `/scim/v2/ServiceProviderConfig` and scope user SQL to `currentTenant().id` (throws if ALS is missing). `--tenancy=rls` FORCE RLS is on `users` as well as `notes`. Extend that module if you need Groups.

## Billing (`FEATURE_BILLING=true`)

Set `STRIPE_WEBHOOK_SECRET`. Signature verification lives in core. Plan sync and usage metering belong in an app module.

## SIEM / audit export (`FEATURE_SIEM_EXPORT=true`)

1. Set `SIEM_EXPORT_URL` to an HTTP ingest endpoint that passes SSRF checks (no private IPs in production).
2. Optional `SIEM_EXPORT_TOKEN`.
3. The schedule task `export-audit-logs` pushes pending rows.

## GitHub OAuth / OIDC / SAML

Set the matching `GITHUB_*` or `OIDC_*` variables. OIDC `getAuthorizationUrl()` throws. Use `createAuthorization()` (async) and pass the handshake to `exchangeCode()`. Authorization, token, and JWKS URLs come from discovery. ID tokens are verified as RS256 via discovery JWKS (`iss` / `aud` / `exp` / `nbf` / `nonce`). Missing or unverified email throws. GitHub OAuth uses `safeFetch`, always reads `/user/emails`, and throws unless a verified address exists (no `{login}@users.noreply.github.com`, and an unverified `profile.email` is ignored).

SAML is a real service provider (`SamlServiceProvider`); set `FEATURE_SAML=true` plus `SAML_IDP_SSO_URL`, `SAML_IDP_CERT`, `SAML_SP_ENTITY_ID`, `SAML_ACS_URL`, and `SAML_IDP_ISSUER`. Signed responses are required; production boot rejects `SAML_WANT_RESPONSE_SIGNED=false`. ACS verifies HMAC RelayState without a cookie and checks assertion issuer. Replay stores assertion IDs in `auth_saml_assertions`. The old `saml:email:name` stub is gone. SAML ACS still challenges MFA when the user is already enrolled.

Outbound URL helpers resolve DNS, reject blocked answers, and fetch the resolved IP with the original Host and TLS server name. `allowPrivate: true` is ignored in production.

## Design rule

Keep vendor SDKs outside `src/core/`. Wrap them in `apps/<your-app>/src/modules/...` adapters so the framework stays usable without Stripe or a specific IdP.
