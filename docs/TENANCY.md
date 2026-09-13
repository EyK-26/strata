# Tenancy and row-level security

`TENANCY_DRIVER` chooses how tenant context is stored:

| Driver | Database | What it does |
|--------|----------|--------------|
| `none` | any | No `tenant` table. Middleware still sets an async-local default tenant (`id` 1). It does not query `tenant` or run `SET LOCAL`. |
| `column` | any | Creates a `tenant` table and `users.tenant_id`. Requests resolve the tenant in application code (ALS). No Postgres `SET LOCAL` / `set_config`. Use this on SQLite and MySQL, or on Postgres when you do not want RLS. |
| `rls` | Postgres | Same tenant table plus `SET LOCAL` / `set_config('app.tenant_id')` on the connection that runs queries. SQLite and MySQL cannot do this. `create-strata` coerces `--tenancy=rls` to `column` on those engines. |

The default in core (unset env) is `rls`. Generated apps write the driver you picked into `.env.example`. Hobby SQLite defaults to `none`.

HTTP requests and background jobs must call `runWithTenantDatabase()` when RLS is on so `app.tenant_id` is set on the connection. Migrations, seeds, and audit export use `runWithMigrationBypass()`, which opens a transaction and `SET LOCAL app.bypass_rls=true`. That unbounded GUC is migrate/seed/audit only. Request auth lookups use `runWithMigrationBypassForIdentifier()`, which opens its own transaction and `SET LOCAL app.bypass_identifier` to the caller-supplied id, email, session id, or token hash. The helper does not rewrite SQL. The policy is the pin: `users` match `id::text` or `email`; `sessions` match `id` or `user_id::text`; `api_tokens` and `auth_one_time_tokens` match `token_hash` or `user_id::text`. Notes and other tenant data honour unbounded `app.bypass_rls()` or `tenant_id = app_current_tenant_id()` only. After the user or session is known, follow-up SQL in the same request uses the request tenant GUC. Note / SCIM / `/health` SQL does not wrap bypass. `column` and `none` skip those Postgres session GUCs. Postgres RLS is the only driver with database-level enforcement; SQLite and MySQL apps should use `column` (application ALS) or `none`.

## Generated HiroApp

`apps/hiroapp` (dogfood for internal end-to-end testing) sets `TENANCY_DRIVER=rls`. The generated schema creates a `tenant` table, seeds slug `default` (id `1`, plan `free`), stores `users.tenant_id`, and puts `tenant_id` on **data** tables such as `notes`. Postgres RLS apps emit `app_current_tenant_id` / `app_bypass_rls` / `app_bypass_identifier` helpers and `ENABLE` + `FORCE ROW LEVEL SECURITY` on `notes` and `users` via `generatedRlsBootstrapSql`. Cookie `sessions`, `api_tokens`, and `auth_one_time_tokens` get a join policy (`users.tenant_id = app_current_tenant_id()`) plus the identifier pin on the real key columns. Auth directory lookups, cookie session reads and writes, token mint, password reset, email verify, and one-time token consume/insert use `runWithMigrationBypassForIdentifier()`, which sets `app.bypass_identifier` and does not set unbounded `app.bypass_rls`. Session and token loads select the auth row first, then the user by id, because a JOIN cannot match both policies at once. One-time consume passes `hashOneTimeToken(token)` so the policy can match `token_hash`. Those policies apply to non-superuser, non-`BYPASSRLS` roles. Generated Compose still creates a `postgres` superuser for volume init, GRANT, migrate, and `migrate:fresh` DROP. Runtime `DATABASE_URL` uses `strata_app` (`NOSUPERUSER` `NOBYPASSRLS`), including `--no-docker`. `db/ensure-postgres-app-role.sql` is repeatable on an existing volume; docker-entrypoint-initdb.d still runs only on first empty volume. Live `pg_roles` runs on every rls runtime pool after it is open (`ensureAppDatabase` + `getSql()`). Username `postgres` or `root` is the URL denylist fast path. Named superuser (`deploy`) is the live inspect. The HiroApp e2e denylist test is the postgres URL fast path. The live inspect e2e is `assertRlsLiveDatabaseRole()` on the `strata_app` pool. It inspects `APP_DATABASE_URL` if set, else `DATABASE_URL`, and never `MIGRATION_DATABASE_URL`. `hiroapp-team` is `TENANCY_DRIVER=none`, so FORCE RLS and the live rls role check are not the control there. SCIM isolation is tenant GUC plus `WHERE tenant_id`. `currentTenantId()` throws if ALS is missing. `createHealthRoutes` without `pingOnHealth` is always 200 JSON and does not read notes. HiroApp `/health` is `schemaReady` (`Note.query().limit(1).get()` under the request tenant; empty notes 200, unreadable not 200). Docker HEALTHCHECK fetches `/health`.

Sibling examples `hiroapp-hobby` and `hiroapp-team` set `TENANCY_DRIVER=none`. A SQLite or MySQL app that wants tenant rows should pass `--tenancy=column`.

## Fixture schema (framework tests)

Core tests still isolate a leftover fixture schema (users, audit, webhooks, and similar) with `app_bypass_rls()` or `tenant_id = app_current_tenant_id()`. That fixture is not a second product. Do not copy those fixture tables into a generated app.

## Auth lookups before tenant GUC

Auth middleware runs before tenant middleware. Lookups that must succeed before `app.tenant_id` is set either bypass RLS or stay off RLS.

| Table | Why |
|-------|-----|
| Generated `users` | `ENABLE` + `FORCE ROW LEVEL SECURITY` on `--tenancy=rls`. Auth directory `findById` / `findByEmail` wrap `runWithMigrationBypassForIdentifier()` with that id or email. Token lookup selects `api_tokens` by `token_hash`, then `users` by `user_id`. Password reset, email verify, MFA enroll, and recovery-hash updates also wrap that identifier-scoped GUC so guest requests (tenant `1`) can update a user in another tenant. After tenant GUC is set, ordinary user queries (including SCIM) are tenant-scoped. |
| Generated `api_tokens` (fixture name `api_token`) | `ENABLE` + `FORCE ROW LEVEL SECURITY` with a join to `users.tenant_id`, plus identifier match on `token_hash` or `user_id::text`. Bearer lookup runs in auth middleware **before** tenant middleware, so it wraps `runWithMigrationBypassForIdentifier(token_hash)` then a second call with `user_id`. Token mint wraps the user id so a guest request (tenant `1`) can insert a row for a user in another tenant. |
| Generated `sessions` | Same join policy as `api_tokens`, plus identifier match on `id` or `user_id::text`. Cookie session load selects the session by id, then the user by `user_id`. Session create/destroy wrap `runWithMigrationBypassForIdentifier()` with the session id or user id. `ForIdentifier(user id)` may see that user's sessions and tokens. That is the session-create pin, not a one-row-only policy. |
| Generated `auth_one_time_tokens` | Same join policy, plus identifier match on `token_hash` or `user_id::text`. Insert wraps the user id. Consume wraps `hashOneTimeToken(token)` so guest password-reset and verify links work for users outside tenant `1`. |
| Optional membership joins | If your app uses membership middleware, it also runs **before** tenant middleware so roles exist for the rest of the request. Generated HiroApp does not use org membership. It stores `users.tenant_id`. |

Global middleware order: auth, then membership, then tenant. Do not reverse that order.

## Default tenant for anonymous requests

Unauthenticated requests still need a tenant (login, register, CSRF). They use tenant `1` (`DEFAULT_TENANT`).

`x-tenant-id` on anonymous requests is honored only when `FEATURE_PUBLIC_READS=true`. Guests already pin to tenant `1`, so `/login` works with `FEATURE_PUBLIC_READS=false` (the code and `.env.example` default). Production boot requires the flag to stay false so guests cannot probe other tenants via that header.

Authenticated non-admin users are pinned to their account tenant. Global admins may override with `x-tenant-id`.

## Background jobs

Jobs that touch RLS tables must call `runWithTenantDatabase()` with an explicit tenant from the job payload. Do not rely on a leftover pooled `app.bypass_rls` or `app.tenant_id` from a previous request.

Webhook dispatch jobs require `tenantId` and scope lookup and delivery to that tenant. Blocked outbound URLs (`assertSafeOutboundUrl`) are recorded and do not fail the originating model write.
