# Tenancy and row-level security

`TENANCY_DRIVER` chooses how tenant context is stored:

| Driver | Database | What it does |
|--------|----------|--------------|
| `none` | any | No `tenant` table. Middleware still sets an async-local default tenant (`id` 1). It does not query `tenant` or run `SET LOCAL`. |
| `column` | any | Creates a `tenant` table and `users.tenant_id`. Requests resolve the tenant in application code (ALS). No Postgres `SET LOCAL` / `set_config`. Use this on SQLite and MySQL, or on Postgres when you do not want RLS. |
| `rls` | Postgres | Same tenant table plus `SET LOCAL` / `set_config('app.tenant_id')` on the connection that runs queries. SQLite and MySQL cannot do this. `create-strata` coerces `--tenancy=rls` to `column` on those engines. |

The default in core (unset env) is `rls`. Generated apps write the driver you picked into `.env.example`. Hobby SQLite defaults to `none`.

HTTP requests and background jobs must call `runWithTenantDatabase()` when RLS is on so `app.tenant_id` is set on the connection. Migrations and seeds use `runWithMigrationBypass()`, which opens a transaction and `SET LOCAL` so the bypass cannot leak onto the next pooled checkout. `column` and `none` skip those Postgres session GUCs. Postgres RLS is the only driver with database-level enforcement; SQLite and MySQL apps should use `column` (application ALS) or `none`.

## Generated HiroApp

`apps/hiroapp` (dogfood for internal end-to-end testing) sets `TENANCY_DRIVER=rls`. The generated schema creates a `tenant` table, seeds slug `default` (id `1`, plan `free`), stores `users.tenant_id`, and puts `tenant_id` on **data** tables such as `notes`. Postgres RLS apps emit `app_current_tenant_id` / `app_bypass_rls` helpers and `ENABLE` + `FORCE ROW LEVEL SECURITY` on `notes` and `users` via `enableTenantRlsSql`. Auth directory lookups and cookie session user loads use `runWithMigrationBypass()` because auth middleware runs before tenant GUC. `sessions` and `api_tokens` stay without RLS so bearer and session lookup can find the user before a tenant is known. SCIM isolation is tenant GUC plus `WHERE tenant_id`. `currentTenantId()` throws if ALS is missing. Generated `/health` reads `Note.query().value("id")` under the request tenant (anonymous requests use tenant `1`), so empty or filtered notes are degraded.

Sibling examples `hiroapp-hobby` and `hiroapp-team` set `TENANCY_DRIVER=none`. A SQLite or MySQL app that wants tenant rows should pass `--tenancy=column`.

## Fixture schema (framework tests)

Core tests still isolate a leftover fixture schema (users, audit, webhooks, and similar) with `app_bypass_rls()` or `tenant_id = app_current_tenant_id()`. That fixture is not a second product. Do not copy those fixture tables into a generated app.

## Auth lookups before tenant GUC

Auth middleware runs before tenant middleware. Lookups that must succeed before `app.tenant_id` is set either bypass RLS or stay off RLS.

| Table | Why |
|-------|-----|
| Generated `users` | `ENABLE` + `FORCE ROW LEVEL SECURITY` on `--tenancy=rls`. Auth directory `findById` / `findByEmail` / token joins and cookie session user loads wrap `runWithMigrationBypass()`. After tenant GUC is set, user queries (including SCIM) are tenant-scoped. |
| Generated `api_tokens` (fixture name `api_token`) | Stay without RLS. Bearer lookup runs in auth middleware **before** tenant middleware. The token finds the user. The user row then supplies `tenant_id`. |
| Generated `sessions` | Stay without RLS. Cookie session load runs before tenant GUC. |
| Optional membership joins | If your app uses membership middleware, it also runs **before** tenant middleware so roles exist for the rest of the request. Generated HiroApp does not use org membership. It stores `users.tenant_id`. |

Global middleware order: auth, then membership, then tenant. Do not reverse that order.

## Default tenant for anonymous requests

Unauthenticated requests still need a tenant (login, register, CSRF). They use tenant `1` (`DEFAULT_TENANT`).

`x-tenant-id` on anonymous requests is honored only when `FEATURE_PUBLIC_READS=true`. Guests already pin to tenant `1`, so `/login` works with `FEATURE_PUBLIC_READS=false` (the code and `.env.example` default). Production boot requires the flag to stay false so guests cannot probe other tenants via that header.

Authenticated non-admin users are pinned to their account tenant. Global admins may override with `x-tenant-id`.

## Background jobs

Jobs that touch RLS tables must call `runWithTenantDatabase()` with an explicit tenant from the job payload. Do not rely on a leftover pooled `app.bypass_rls` or `app.tenant_id` from a previous request.

Webhook dispatch jobs require `tenantId` and scope lookup and delivery to that tenant. Blocked outbound URLs (`assertSafeOutboundUrl`) are recorded and do not fail the originating model write.
