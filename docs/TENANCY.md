# Tenancy and row-level security

Postgres row-level security is a framework feature (`TENANCY_DRIVER=rls`, the default). Set `TENANCY_DRIVER=none` for apps that do not have a `tenant` table. In that mode, tenant middleware is async-local only. It does not run `SET LOCAL` or query `tenant`.

HTTP requests and background jobs must set `app.tenant_id` on the connection that runs queries (`runWithTenantDatabase()`) when RLS is on. Migrations and seeds use `runWithMigrationBypass()`.

## Generated HiroApp

`apps/hiroapp` sets `TENANCY_DRIVER=rls`. The generated schema creates a `tenant` table, seeds slug `default` (id `1`), and stores `users.tenant_id`. It does not emit `ENABLE ROW LEVEL SECURITY` policies or call a helper named `isolateTenantTable`.

Sibling examples `hiroapp-hobby` and `hiroapp-team` set `TENANCY_DRIVER=none`. SQLite and MySQL starters cannot choose RLS.

## Fixture schema (framework tests)

Core tests still isolate a leftover fixture schema (users, audit, webhooks, and similar) with `app_bypass_rls()` or `tenant_id = app_current_tenant_id()`. That fixture is not a second product. Do not copy those hiring-era tables into a generated app.

## Auth-global tables (no RLS)

Bearer lookup and optional membership joins stay global on purpose.

| Table | Why |
|-------|-----|
| Generated `api_tokens` (fixture name `api_token`) | Bearer lookup runs in auth middleware **before** tenant middleware. The token finds the user. The user row then supplies `tenant_id`. RLS here would hide tokens until a tenant was already known. |
| Optional membership joins | If your app uses membership middleware, it also runs **before** tenant middleware so roles exist for the rest of the request. Generated HiroApp does not use org membership. It stores `users.tenant_id`. |

Global middleware order: auth, then membership, then tenant. Do not reverse that order.

## Default tenant for anonymous requests

Unauthenticated requests still need a tenant (login, register, CSRF). They use tenant `1` (`DEFAULT_TENANT`).

`x-tenant-id` on anonymous requests is honored only when `FEATURE_PUBLIC_READS=true`. Generated HTML apps set that flag in `.env.example` so local guests can load `/login`. There is no public careers board. Production boot requires `FEATURE_PUBLIC_READS=false` so guests cannot probe other tenants via that header.

Authenticated non-admin users are pinned to their account tenant. Global admins may override with `x-tenant-id`.

## Background jobs

Jobs that touch RLS tables must call `runWithTenantDatabase()` with an explicit tenant from the job payload. Do not rely on a leftover pooled `app.bypass_rls` or `app.tenant_id` from a previous request.

Webhook dispatch jobs require `tenantId` and scope lookup and delivery to that tenant. Blocked outbound URLs (`assertSafeOutboundUrl`) are recorded and do not fail the originating model write.
