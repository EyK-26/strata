# create-strata changelog

## 1.1.0

Breaking security hardening for generated apps, lockstep with `@getstrata/core` 1.1.0. Read the core 1.1.0 migration list.

CSRF on HTML plus session-mutating API. Guest JSON login relies on SameSite=Lax plus CORS, not double-submit. `GET /api/v1/auth/csrf` Set-Cookies the HttpOnly CSRF cookie.

SAML is HMAC RelayState without a Lax cookie. Replay uses `auth_saml_assertions`. Signed responses and a required IdP issuer are the default. JIT uses `currentTenantId()` and is skipped when `FEATURE_REGISTRATION=false`. SAML and OIDC skip password MFA (SSO).

MFA is when enrolled, on HTML password POST, HTML MFA, API, JWT, and Basic. Recovery hashes are persisted. `verifyCredentials` does not skip MFA.

Password reset consumes one-time tokens atomically, compares aliased `sessions.created_at` to `session_valid_after` (not `users.created_at`), and deletes `sessions` plus `api_tokens`. JwtGuard rejects tokens issued before `session_valid_after`. Verify GET does not sign in.

`--tenancy=rls` FORCE RLS is on `notes` and `users`. Auth lookups use `runWithMigrationBypass`. SCIM scopes by `tenant_id` and throws if tenant ALS is missing. `/health` is degraded until a notes row is readable under the request tenant.

OIDC verifies RS256 ID tokens via discovery JWKS and a persisted PKCE handshake. GitHub OAuth uses `safeFetch`, reads `/user/emails` when the profile omits email, and rejects a missing verified address.

MFA secrets require `KMS_ENCRYPTION_KEY` whenever `FEATURE_MFA` is on, including local. Seed password is `StrataDemo!ChangeMe`. HTMX is the unpkg 2.0.4 pin. Generated login tokens mint `[]` abilities.

## 1.0.9

Label HiroApp as internal e2e dogfood and seed notes via Model

## 1.0.8

- Container image starts and ships production dependencies only.

## 1.0.7

Always-custom wizard: frontend, one database engine, auth, tenancy, cache, queue, mail, extras, then optional Docker Compose per selected tool. In-repo example apps are generated from the same script.

## 1.0.6

- Generated apps depend on `@getstrata/*@^1.0.6`.

## 1.0.5

- Generated apps depend on `@getstrata/*@^1.0.5`.

## 1.0.4

- Generated header auth enables `x-authenticated-user-id` only when `AUTH_DEV_HEADERS` is exactly `true`.
- Generated `createApp` calls `isProductionEnv()` so `NODE_ENV=production` runs `assertProductionSecrets()` and skips auto-migrate.
- Generated apps depend on `@getstrata/*@^1.0.4`.

## 1.0.3

- Generated apps depend on `eta` themselves (welcome HTML). `mysql2` is added only for `--database mysql`. Core no longer ships either as a hard dependency.
- Generated apps depend on `@getstrata/*@^1.0.3`.
- Generated `docs/API.md` documents `GET /ready` again. 1.0.2 removed it on the premise that generated apps only serve `/health`; they spread `createHealthRoutes()`, so `/ready` is live. The row states what it checks (database ping, Redis ping only when `REDIS_URL` is set, no schema probe) and that `/health` remains the deploy gate. The boot test asserts `/ready` 200 JSON next to `/health` 503 on an unmigrated database.

## 1.0.2

- Generated `docs/API.md` lists `GET /health` only (plain text `ok`, or 503 `degraded` until the database ping and the `notes` table exist). It no longer claims a `GET /ready` JSON twin. Docker HEALTHCHECK already probes `/health`.

## 1.0.1

- Generated apps pass their own `bun run check`. Fixed `sql.unsafe<Array<T>>` double-wrapping (`unsafe<T>` already resolves to `T[]`) and the `AuthUserDirectory` import path.
- Accept a directory path as the project name. `bunx create-strata /tmp/my-app` used to fail validation.
- Generated apps ship a production `Dockerfile` (multi-stage, `oven/bun:1.4`, non-root, `HEALTHCHECK`, `APP_ENV=production`, `AUTH_DEV_HEADERS=false`, frontend built in-image for spa/hybrid, `VOLUME /app/storage` for SQLite) and a `.dockerignore`, plus a README "Deploy" section.
- `GET /health` answers 503 `degraded` until the database responds and the starter schema exists; `/ready` returns the same as JSON. A fresh deploy stays out of rotation until migrated.
- `SESSION_SECRET` has no generated fallback. Cookie apps read it through `sessionSecret()` in `src/bootstrap/config.ts` and refuse to boot without it.
- README production list adds `APP_URL`, `TRUST_FORWARDED_FOR` behind proxies, and the production CORS default. `.gitignore` covers SQLite WAL side files.
- Printed next steps use `bun run db:migrate` and `bun run dev`. `strata` installs into the app, not onto `PATH`.
- MySQL apps migrate and boot. Bounded the keyed and defaulted string columns MySQL cannot index or default, added the missing `CREATE DATABASE`, and formatted timestamps for `DATETIME`.
- `ensureAppDatabase()` keeps the database name from `DATABASE_URL` instead of forcing a `<project>_test` rename.
- Inapplicable extras passed as flags now warn and stay off, matching the wizard. `--auth headers --mfa` no longer writes `FEATURE_MFA=true` into an app with no MFA code.
- `spa-react` and `hybrid` apps ship the `frontend:install` and `frontend:build` scripts the 503 page names, and the SPA calls only endpoints the generated backend serves.
- `docs/API.md` is generated per layer, so it lists only routes the app actually has.
- `strata start` does not migrate when `APP_ENV=production`.

## 1.0.0

- First stable release. Interactive lists take arrow keys from the terminal fds under `bunx`. Postgres and MySQL Compose stacks include Adminer. Generated apps depend on `@getstrata/*@1.0.0`.

## 0.1.13

- Interactive lists take ↑/↓ from the terminal fds, including `bunx`, instead of opening readline first (that path printed `Choose [1]:` with no arrows).

## 0.1.12

- Postgres and MySQL Compose stacks include Adminer (http://localhost:8080) unless you pass a `--docker-services` list without `adminer`. SQLite and `--no-docker` do not get it. Mix mode asks after the database container.

## 0.1.11

- Interactive lists use ↑/↓ and Enter. Number keys still pick an option.
- Extras (MFA, email verification, SCIM, metrics) are a toggle list: move with arrows, Space or 1-9 to enable one by one, Enter to continue.
- The extras list is filtered by earlier answers: header auth only offers metrics; MFA needs cookie HTML; SCIM and email verification need a users table. Flags such as `--no-metrics` remove that extra from the list.
- Metrics `GET /metrics` is generated only when the metrics extra is on.
- Yes/no prompts use ↑/↓ (or y / n) instead of only typing.

## 0.1.10

- Cookie / cookie-* apps get a restyleable HTML auth kit: welcome, login, register, forgot/reset password (`views/` + `public/assets/site.css`).
- Token and JWT apps get JSON register and password reset.
- `--tenancy=column` writes a tenant table on any engine. sqlite/mysql `--tenancy=rls` becomes `column` instead of `none`.
- Selected extras emit MFA pages, email verification, and a SCIM `/Users` adapter (not env flags alone).
- `strata migrate` seeds empty tables (demo login after migrate).
- Seed and email-verify timestamps bind as ISO strings so SQLite parameter binding succeeds.
