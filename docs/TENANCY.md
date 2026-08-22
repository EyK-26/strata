# Tenancy and row-level security

WorkHub scopes tenant data with Postgres RLS. HTTP requests and background jobs must set `app.tenant_id` on the connection that runs queries (`runWithTenantDatabase()`). Migrations and seeds use `runWithMigrationBypass()`.

## Tables with `tenant_isolation`

RLS is forced on these tables (`app_bypass_rls()` or `tenant_id = app_current_tenant_id()`):

- `organization`, `users`, `audit_log`, `project`, `task`, `comment`, `webhook`
- `notification`, `task_attachment`, `subscription`

## Auth-global tables (no RLS)

`api_token` and `organization_member` stay global on purpose.

| Table | Why |
|-------|-----|
| `api_token` | Bearer lookup happens in auth middleware **before** tenant middleware. A token identifies the user; the user row then supplies `tenant_id`. Adding RLS here would hide tokens until a tenant is already known. |
| `organization_member` | Membership middleware also runs **before** tenant middleware so org roles are available for the rest of the request. Members can belong to orgs across the user's tenant; isolation is enforced later via `organization.tenant_id` RLS and membership-scope helpers. |

Global middleware order: auth → membership → tenant. Do not reverse that order.

## Default tenant for anonymous requests

Unauthenticated requests still need a tenant context (login, register, CSRF). They use tenant `1` (`DEFAULT_TENANT`).

`x-tenant-id` on anonymous requests is honored only when `FEATURE_PUBLIC_READS=true` (local dogfood / public demo). Production requires `FEATURE_PUBLIC_READS=false`, so guests cannot probe other tenants via that header.

Authenticated non-admin users are always pinned to their account tenant. Global admins may override with `x-tenant-id`.

## Background jobs

Jobs that touch RLS tables must call `runWithTenantDatabase()` with an explicit tenant from the job payload. Do not rely on a leftover pooled `app.bypass_rls` or `app.tenant_id` from a previous request.

`DispatchWebhookJob` requires `tenantId` and scopes the webhook lookup and delivery insert to that tenant.
