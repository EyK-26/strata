# create-strata changelog

## 1.1.1

Fix generated app boot

## 1.1.0

Breaking security hardening for generated apps, lockstep with `@getstrata/core` 1.1.0. Read the core 1.1.0 migration list.

CSRF on HTML and on mutating API routes, including guest JSON login (`POST /api/v1/auth/login`) and JWT mint (`POST /api/auth/token`). Fetch `GET /api/v1/auth/csrf` first. That response Set-Cookies the HttpOnly CSRF cookie and returns the same token in JSON. Send `X-CSRF-Token` (or form `_token`) plus the cookie. Nested API CSRF does not mint a second cookie. A missing token is JSON 403. CORS allowlists `X-CSRF-Token` and, when reflecting a specific origin, sets `Access-Control-Allow-Credentials`. The CSRF cookie is `SameSite=Lax`, so a different site cannot send it on fetch. Bearer and Basic skip CSRF only after that guard authenticates (`successful bearer or basic skips CSRF`). `failed Bearer header does not skip CSRF when credentialSource is null` is the Bearer header skip when `credentialSource` is null. `failed bearer does not fall back to a session or guest guard` is failed Bearer not resolving a session or guest user. HiroApp e2e `cookie login requires CSRF and ignores garbage Bearer` is garbage Bearer still requiring CSRF on POST `/login`. SCIM and SAML ACS skip CSRF by path. A missing or foreign `Origin` on a cookie mutating request is 403. `GET /login` and `GET /api/v1/auth/csrf` do not require Origin. The IdP-shaped ACS e2e is a test `fetch` to the app origin with `idpShapedHeaders()` Origin/Referer and HMAC RelayState, not a browser IdP POST.

SAML is HMAC RelayState without a Lax cookie. Replay defaults to SQL `auth_saml_assertions`. Tests may use in-memory. Both drop IDs after 1 hour. Signed responses and a required IdP issuer are the default. ACS compares assertion issuer to `SAML_IDP_ISSUER`. JIT uses `currentTenantId()` and is skipped when `FEATURE_REGISTRATION=false`. Generated SAML ACS still challenges MFA when `mfa_enabled` is true. Completing MFA enrollment revokes sessions and API tokens. There is no generated OIDC cookie login.

MFA is when enrolled, on HTML password POST, HTML MFA, API token mint, JWT mint, and Basic mint. Recovery hashes are persisted. `verifyCredentials` does not skip MFA. JwtGuard does not run TOTP on each request.

Password reset consumes one-time tokens atomically, compares aliased `sessions.created_at` to `session_valid_after` (not `users.created_at`), and deletes `sessions` plus `api_tokens`. JwtGuard rejects tokens issued before `session_valid_after`. Verify GET does not sign in.

`--tenancy=rls` FORCE RLS is on `notes` and `users`. `sessions`, `api_tokens`, and `auth_one_time_tokens` get a user-join policy plus an `app.bypass_identifier` pin on the real key columns. Auth lookups and those auth-table writes use `runWithMigrationBypassForIdentifier()`, which sets that GUC and does not rewrite SQL. Consume passes `hashOneTimeToken(token)`. SCIM scopes by `tenant_id` and throws if tenant ALS is missing. `createHealthRoutes` without `pingOnHealth` is always 200 JSON. Generated and HiroApp `/health` overwrite that with `schemaReady` (empty notes 200, unreadable not 200). Docker HEALTHCHECK fetches `/health`. Generated Compose still has a `postgres` superuser for volume init, GRANT, migrate, `migrate:fresh` DROP, and Adminer. Runtime `DATABASE_URL` uses `strata_app` (`NOSUPERUSER` `NOBYPASSRLS`), including `--no-docker`. Generated MySQL is still `mysql://root:…`. Production Compose runtime is `strata_app` after the split (`STRATA_APP_PASSWORD` required). This CI does not boot prod compose. `db/ensure-postgres-app-role.sql` is repeatable on an existing volume. Every rls runtime pool, including local, rejects username `postgres` or `root`, then inspects live `pg_roles`.

OIDC verifies RS256 ID tokens via discovery JWKS and a persisted PKCE handshake. App JWTs stay HS256. `at_hash` is verified when present; omitted `access_token` plus `at_hash` throws. GitHub OAuth uses `safeFetch`, always reads `/user/emails`, and rejects a missing verified address.

`GuestGuard`: production (`isProductionEnv`, including staging) is always null even when `AUTH_DEV_HEADERS=true`. Local `AUTH_DEV_HEADERS=true` still reads request headers.

Identity response headers are never set.

MFA is when enrolled. Enrollment is optional. Secrets are `enc:v1:` when a KMS key is set or in production. Local without a key may still return plaintext. Seed password is `StrataDemo!ChangeMe`. HTMX is the unpkg 2.0.4 pin. Generated login tokens mint `[]` abilities. Generated Compose Postgres password is `dev-postgres-change-me`. Generated Compose application role is `strata_app` / `dev-strata-app-change-me`. Generated Compose MySQL root password is `dev-mysql-change-me`. `127.0.0.1:54329` / `6379` / `33061` stay published. Adminer is debug-profile only.

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
