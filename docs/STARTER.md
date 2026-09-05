# Starter

`bunx create-strata` scaffolds a runnable Strata app. The wizard always asks each layer: frontend, one database engine, auth, tenancy, cache, queue, mail, optional extras, then Docker vs local installs.

HiroApp in this repo is one generated example (`apps/hiroapp`: Postgres + HTMX). It is not the source of the wizard. Sibling examples: `apps/hiroapp-hobby` (SQLite API) and `apps/hiroapp-team` (Postgres HTML + Redis). Regenerate them with `bun run generate:example-apps`.

## Quick start

```bash
bunx create-strata my-app
cd my-app
cp .env.example .env
bun install
strata migrate
strata dev
```

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
| `--tenancy` | `none`, `rls` |
| `--cache` | `array`, `redis` |
| `--queue` | `sync`, `redis` |
| `--mail` | `log`, `smtp` |
| `--spa-prefix` | default `/app` |

Extras (off unless you pass flags or answer yes in the wizard): `--mfa`, `--email-verification`, `--scim`, `--metrics`.

You can add cache, SMTP, Redis, or another auth mode later by changing env and the matching bootstrap files. The generator only installs what you asked for.

## Docker vs local tools

Postgres, MySQL, Redis, and SMTP can run in Docker Compose or as installs already on the machine. The wizard asks after layers. It is skipped when those tools are not needed.

| Flag | Effect |
|------|--------|
| `--docker` | Write Compose for every selected tool that needs a service |
| `--no-docker` | Do not write `docker-compose.yml`; point env at local installs |
| `--docker-services=postgres,redis` | Compose only for that subset |

`--yes` does not write Compose unless you pass `--docker` or `--docker-services`. Compose never mixes two database engines.

## What you get that actually runs

- `GET /health` after `strata migrate`
- Notes table on every app
- Cookie apps: `users` + `sessions`, HTML `/login`, seed `demo@example.com` / `password`
- Token apps: `POST /api/v1/auth/login`
- JWT apps: `POST /api/auth/token`
- `strata.layers.json` records the choices

`APP_ENV=production` calls `assertProductionSecrets()` on boot.

## In this repo

`strata new my-app --yes` calls the same generator. `strata new --frontend=hybrid` (no project name) still overlays HTML/SPA files into the current directory.

Example apps are generated from `scripts/generate-example-apps.ts`. The original hiring product was removed until it can be rebuilt on this generator without mixing Postgres and MySQL.
