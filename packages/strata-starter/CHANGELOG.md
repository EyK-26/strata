# create-strata 1.0.0

Always-custom wizard: frontend, one database engine, auth, tenancy, cache, queue, mail, extras, then optional Docker Compose per selected tool. In-repo example apps are generated from the same script.

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
