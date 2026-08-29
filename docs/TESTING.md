# Testing WorkHub

WorkHub supports three frontend modes (`FRONTEND_MODE`):

| Mode | Value | What runs |
|------|-------|-----------|
| JSON API only | `api` | `/api/v1/*` routes |
| Server HTMX | `server-htmx` | HTML views under `/organizations`, `/projects`, `/tasks`, `/search`, `/reports`, `/account` (profile name/email, password + MFA + recovery codes), `/confirm-password` (export/delete), `/two-factor-challenge` (Fortify 2FA), `/notifications`, `/billing`, `/webhooks`, `/forgot-password`, etc. |
| SPA + API | `spa-react` | React app at `/app/*` plus the JSON API |

Set the mode in `.env` or export it before starting the server.

## Seeded users

After `bun run cli migrate:fresh --seed` (or integration test setup), these accounts exist:

| Email | Password | Role |
|-------|----------|------|
| `admin@workhub.test` | `password` | Global admin |
| `member@workhub.test` | `password` | Member |

## Bearer tokens (API / SPA)

1. `POST /api/v1/auth/login` with `{ "email", "password" }`, or `POST /api/v1/auth/register` with `{ "name", "email", "password", "password_confirmation" }` (register also creates `{name}'s workspace` with slug `personal-{userId}`; a blocked existing webhook URL does not fail that write).
2. Use the returned token as `Authorization: Bearer <token>`.

Forgot / reset (JSON): `POST /api/v1/auth/forgot-password` with `{ "email" }`, then `POST /api/v1/auth/reset-password` with `{ "email", "token", "password", "password_confirmation" }`. Resend verify: `POST /api/v1/auth/email/verification-notification` with `{ "email" }`. Profile: `PATCH /api/v1/users/me` with `{ "name", "email" }` (Fortify UpdateProfileInformation; email change + `FEATURE_EMAIL_VERIFICATION=true` clears verification and sends a new link). JSON MFA: `POST /api/v1/users/me/mfa` (secret + otpauth URL), `POST /api/v1/users/me/mfa/confirm` `{ "mfa_code" }` (returns recovery codes), `POST /api/v1/users/me/mfa/recovery-codes` `{ "password" }`, `DELETE /api/v1/users/me/mfa` `{ "password" }`. HTML notice: `GET /email/verify` (`FEATURE_EMAIL_VERIFICATION=true`; Laravel `verified` sends unverified sessions there).

Integration tests and the SPA client use `cache: 'no-store'` on API fetches.

## HTMX session login

1. `GET /login` — read `csrf-token` meta and `workhub_csrf` cookie.
2. `POST /login` with form fields `email`, `password`, `redirect`, `_token`, and optional `remember=1` (30-day HMAC session; `SESSION_REMEMBER_TTL_SECONDS`). Optional `mfa_code` completes MFA in one step; otherwise `FEATURE_MFA=true` accounts go to `GET/POST /two-factor-challenge` (`workhub_mfa_pending`).
3. Follow `workhub_session` cookie on subsequent requests.
4. Sensitive HTML (`GET /account/export`, `POST /account/delete`) requires a recent `POST /confirm-password` (`workhub_password_confirmed` cookie).

HTMX mutating requests send `X-CSRF-Token` automatically (see `resources/views/layouts/app.eta`).

## Running tests

```bash
# Unit tests
bun run unit

# Integration tests (requires DATABASE_URL, run via Docker in CI)
QUEUE_DRIVER=sync bun run integration

# Full suite with scoped 100% coverage gate — see docs/COVERAGE.md
bun run test:coverage

# CI parity (Docker)
docker compose run --rm -e QUEUE_DRIVER=sync -e WORKHUB_SKIP_TEST_BOOTSTRAP=1 app bun run validate:ci

# Host-native (Postgres/Redis on localhost:54329 / 6379)
bun run validate:host
```

## Tenant-scoped database access

Postgres row-level security reads `app.tenant_id` from the connection that executes each query. With a pooled connection (`DB_POOL_MAX > 1`), session-level `SET app.tenant_id` is not reliable.

Use `runWithTenantDatabase()` from `src/core/tenant/tenantDatabaseScope.ts` whenever code talks to tenant-isolated tables outside the HTTP middleware stack (unit tests, scripts, background jobs):

```typescript
import { runWithTenantDatabase } from "../../src/core/tenant/tenantDatabaseScope";

await runWithTenantDatabase(tenant, async () => {
  // ALS tenant context + pinned transaction with SET LOCAL app.tenant_id
});
```

HTTP middleware (`createTenantMiddleware`, SCIM auth) uses the same helper so production and tests share one code path. Background jobs that touch RLS tables must do the same — see [TENANCY.md](./TENANCY.md).

For migration/seed/bootstrap queries that must read across tenants, use `runWithMigrationBypass()` from `src/core/tenant/databaseTenantContext.ts`.

For HTMX integration tests, set `FRONTEND_MODE=server-htmx`.

CI runs `migrate:fresh --seed` before the test suite and sets `WORKHUB_SKIP_TEST_BOOTSTRAP=1` so the Bun preload does not reset the database a second time. Local `bun test` without a prior migrate uses `tests/globalSetup.ts` to seed once at startup. That reset refuses `APP_ENV=production` and non-test `DATABASE_URL` values unless `WORKHUB_ALLOW_TEST_DB_RESET=1`.

Coverage exclusions and rationale: [COVERAGE.md](./COVERAGE.md).

## `createTestApp`

```typescript
import { createTestApp } from "../../src/testing/createTestApp";

const app = createTestApp();
const response = await app.fetch(new Request("http://localhost/api/v1/organizations"));
```

Pass env vars (`DATABASE_URL`, `QUEUE_DRIVER=sync`, etc.) before importing bootstrap modules.

## Local development

```bash
# Host-native against Docker-published ports (recommended on the machine)
bun run dev:host

# Inside Docker Compose app container
docker compose up

# Manual host env
bun run dev
```

`bun run dev` watches `src/bootstrap/server.ts` and reloads on change.

## Frontend (SPA)

```bash
cd frontend
bun install
bun run dev    # Bun HTML/HMR server (proxies /api to the WorkHub API)
bun run test   # bun test
```

Build for production: `bun run build:frontend` from the repo root.
