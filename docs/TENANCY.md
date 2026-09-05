# Tenancy and row-level security

HiroApp (and the framework fixture schema) scope tenant data with Postgres RLS (`TENANCY_DRIVER=rls`, the default). Set `TENANCY_DRIVER=none` for apps that do not have a `tenant` table (the starter template). In that mode, tenant middleware is async-local only. It does not run `SET LOCAL` or query `tenant`.

HTTP requests and background jobs must set `app.tenant_id` on the connection that runs queries (`runWithTenantDatabase()`) when RLS is on. Migrations and seeds use `runWithMigrationBypass()`.

## Tables with `tenant_isolation`

RLS is forced on isolated tables (`app_bypass_rls()` or `tenant_id = app_current_tenant_id()`). HiroApp hiring tables that call `isolateTenantTable` join that set. Core tests still isolate a leftover fixture schema (users, audit, webhooks, and similar). That fixture is not a second product.

## Auth-global tables (no RLS)

`api_token` and membership-style join tables stay global on purpose.

| Table | Why |
|-------|-----|
| `api_token` | Bearer lookup runs in auth middleware **before** tenant middleware. The token finds the user. The user row then supplies `tenant_id`. RLS here would hide tokens until a tenant was already known. |
| Optional membership joins | If your app uses membership middleware, it also runs **before** tenant middleware so roles exist for the rest of the request. HiroApp does not use org membership. It scopes hiring rows with `users.tenant_id` and RLS. |

Global middleware order: auth, then membership, then tenant. Do not reverse that order.

## Default tenant for anonymous requests

Unauthenticated requests still need a tenant (login, register, CSRF). They use tenant `1` (`DEFAULT_TENANT`).

`x-tenant-id` on anonymous requests is honored only when `FEATURE_PUBLIC_READS=true` (career board / public demo). Production should set `FEATURE_PUBLIC_READS=false` unless you intentionally publish reads, so guests cannot probe other tenants via that header.

Authenticated non-admin users are pinned to their account tenant. Global admins may override with `x-tenant-id`.

## Background jobs

Jobs that touch RLS tables must call `runWithTenantDatabase()` with an explicit tenant from the job payload. Do not rely on a leftover pooled `app.bypass_rls` or `app.tenant_id` from a previous request.

Webhook dispatch jobs require `tenantId` and scope lookup and delivery to that tenant. Blocked outbound URLs (`assertSafeOutboundUrl`) are recorded and do not fail the originating model write.
