# create-strata changelog

Always-custom wizard: frontend, one database engine, auth, tenancy, cache, queue, mail, extras, then optional Docker Compose per selected tool. In-repo example apps are generated from the same script.

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
