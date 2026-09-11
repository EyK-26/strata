# Starter

`bunx create-strata` scaffolds a runnable Strata app. The wizard always asks each layer: frontend, one database engine, auth, tenancy, cache, queue, mail, extras, then Docker vs local installs. Extra checkboxes depend on earlier answers (header auth does not offer MFA or SCIM). In a terminal, lists are ↑/↓ and Enter (or a number). Extras are toggled one by one with Space. If you see `Choose [1]:` instead, bunx did not get raw keyboard mode. Retry in a real terminal, or pass `--yes` with layer flags.

HiroApp in this repo (`apps/hiroapp`: Postgres + HTMX) is dogfood for internal end-to-end testing. It is not a product and it is not the source of the wizard. Sibling apps `apps/hiroapp-hobby` (SQLite API) and `apps/hiroapp-team` (Postgres HTML + Redis) are generated layer maps and are not CI dogfood. Regenerate them with `bun run generate:example-apps`.

## Quick start

```bash
bunx create-strata my-app
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

`strata` installs into the app rather than globally, so use the `bun run` scripts above, or `bunx strata <command>` from inside the app directory.

In CI, pass `--yes` and the layers you want. Defaults (no flags) are SQLite, JSON API, header auth:

```bash
bunx create-strata my-app --yes
bunx create-strata html --frontend server-htmx --database postgres --auth cookie --cache redis --queue redis --docker --yes
```

## Layers

| Flag | Values |
|------|--------|
| `--frontend` | `api`, `server-htmx`, `spa-react`, `hybrid` |
| `--database` | `sqlite`, `postgres`, `mysql` (one engine; not mixed) |
| `--auth` | `headers`, `cookie`, `token`, `jwt`, `cookie-token`, `cookie-token-jwt` |
| `--tenancy` | `none`, `column`, `rls` (`rls` is Postgres `SET LOCAL`; sqlite/mysql coerce `rls` to `column`) |
| `--cache` | `array`, `redis` |
| `--queue` | `sync`, `redis` |
| `--mail` | `log`, `smtp` |
| `--spa-prefix` | default `/app` |

Extras that apply to the stack (off until you toggle them, or pass flags): `--mfa`, `--email-verification`, `--scim`, `--metrics`. Header auth only offers metrics. MFA needs cookie HTML. SCIM and email verification need a users table. `--no-metrics` skips the metrics extra and does not write `GET /metrics`.

You can add cache, SMTP, Redis, or another auth mode later by changing env and the matching bootstrap files. The generator only installs what you asked for. Generated apps always depend on `eta` (welcome HTML). `mysql2` is added only for `--database mysql`.

## Docker vs local tools

Postgres, MySQL, Redis, SMTP, and Adminer can run in Docker Compose. Adminer is a database UI and is only offered when Postgres or MySQL is in Compose (not SQLite, and not when the database is a local install). The wizard asks after layers.

| Flag | Effect |
|------|--------|
| `--docker` | Write Compose for every selected tool that needs a service, plus Adminer when the database is in Compose |
| `--no-docker` | Do not write `docker-compose.yml`; point env at local installs |
| `--docker-services=postgres,redis` | Compose only for that subset. Add `adminer` to include the UI |

`--yes` does not write Compose unless you pass `--docker` or `--docker-services`. Compose never mixes two database engines.

## What you get that actually runs

- `GET /health` after `strata migrate` (plain text `ok`, or 503 `degraded` until the database ping and the `notes` table exist). Docker HEALTHCHECK uses `/health`. Migrate also seeds when the tables are empty.
- `GET /ready` (from `@getstrata/bootstrap/health`): JSON database and Redis pings, 200 or 503. No schema check, so it can be 200 before the first migrate; `/health` is the gate.
- Notes table and a `Note` model on every app. Seed and `/health` use `Note.query().value`. There is no notes CRUD route.
- Cookie / cookie-* apps (HTML auth kit you can restyle): welcome `/`, `/login`, `/register`, `/forgot-password`, signed `/reset-password`. Edit `views/*.eta`, `views/layouts/app.eta`, and `public/assets/site.css`. Seed `demo@example.com` / `password`
- Token apps: `POST /api/v1/auth/login`, `/api/v1/auth/register`, `/api/v1/auth/forgot-password`
- JWT apps: `POST /api/auth/token` plus the same JSON register/reset routes
- Header auth: restyleable welcome page only (send `x-authenticated-user-id` in local/tests)
- `--tenancy=column`: `tenant` table + `users.tenant_id` on any engine. `--tenancy=rls`: Postgres only (`SET LOCAL`). sqlite/mysql `rls` becomes `column`
- Extras: MFA cookie challenge (`/login/mfa`, `/account/mfa`), email verification (`/email/verify`), SCIM `/scim/v2/Users`, metrics `GET /metrics` (only when that extra is on)
- `strata.layers.json` records the choices

`APP_ENV=production` (or `NODE_ENV=production`) calls `assertProductionSecrets()` on boot.

## In this repo

`strata new my-app --yes` calls the same generator. `strata new --frontend=hybrid` (no project name) still overlays HTML/SPA files into the current directory.

In-repo apps are generated from `scripts/generate-example-apps.ts`. Only `apps/hiroapp` is CI dogfood.
