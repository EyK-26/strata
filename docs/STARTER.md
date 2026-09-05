# Starter kits

`bunx create-strata` scaffolds a runnable Strata app. You pick a kit, or you pick each layer. The same generator covers a hobby SQLite API and an enterprise hybrid app.

HiroApp (`apps/hiroapp`) is the in-repo hiring product. It is **not** generated from this starter. Use a hiring recipe when you want a new hiring-shaped app. See `apps/hiroapp/starter-layers.json` for the retroactive map.

## Quick start

```bash
bunx create-strata my-app
cd my-app
cp .env.example .env
bun install
strata migrate
strata dev
```

In a terminal the CLI asks for a kit, then optionally each layer. In CI:

```bash
bunx create-strata my-app --kit hobby --yes
bunx create-strata hiring --kit hiroapp-enterprise --yes
```

## Kits

| Kit | Frontend | Database | Auth | Typical use |
|-----|----------|----------|------|-------------|
| `hobby` | `api` | SQLite | Dev headers | Local spike, file SQLite |
| `team` | `server-htmx` | Postgres | Cookie sessions | Staff HTML, Redis cache/queue |
| `enterprise` | `hybrid` | Postgres | Cookies + opaque tokens + JWT | RLS env, SMTP, sidecars |
| `custom` | you pick | you pick | you pick | Any mix of the layers below |
| `hiroapp-hobby` | `hybrid` | SQLite | Cookie + token, `/apply` | Hiring-shaped skeleton |
| `hiroapp-team` | `hybrid` | Postgres | Cookie + token, `/apply` | Hiring-shaped with Redis |
| `hiroapp-enterprise` | `hybrid` | Postgres | Cookie + token + JWT, `/apply` | Hiring-shaped corporate extras |

Hiring aliases also work: `hiroapp_build_from_starter_kit_x_level_hobby`, `_team`, `_enterprise` (and `_entreprise`).

## Layers

Pass any of these as flags. They override the kit.

| Flag | Values |
|------|--------|
| `--frontend` | `api`, `server-htmx`, `spa-react`, `hybrid` |
| `--database` | `sqlite`, `postgres`, `mysql` |
| `--auth` | `headers`, `cookie`, `token`, `jwt`, `cookie-token`, `cookie-token-jwt` |
| `--tenancy` | `none`, `rls` |
| `--cache` | `array`, `redis` |
| `--queue` | `sync`, `redis` |
| `--mail` | `log`, `smtp` |
| `--spa-prefix` | default `/app`; hiring recipes use `/apply` |

Corporate extras (on by default for enterprise kits, or pass `--corporate` to prompt):

`--mfa`, `--email-verification`, `--scim`, `--metrics`, `--kiosk`, `--mysql-mirror` (each has a `--no-*` form).

These extras write env stubs and, for kiosk/mirror, a `bindSidecars()` helper. They do not copy HiroApp domain modules.

## Docker vs local tools

Postgres, MySQL, Redis, and SMTP can run in Docker Compose or as installs already on the machine. The wizard asks after you pick layers. It is skipped when those tools are not needed (SQLite plus in-process cache/queue and log mail).

| Flag | Effect |
|------|--------|
| `--docker` | Write Compose for every selected tool that needs a service |
| `--no-docker` | Do not write `docker-compose.yml`; point env at local installs |
| `--docker-services=postgres,redis` | Compose only for that subset, intersected with what the kit needs |

Non-interactive defaults: hobby kits skip Compose; team and enterprise kits write Compose for every needed service. Pass `--no-docker` when Postgres or Redis already run on the machine.

`custom` with `--yes` does not write Compose unless you pass `--docker` or `--docker-services`.

Compose only includes services for the layers you selected (Postgres kit without Redis will not add a Redis container).

## What you get that actually runs

- `GET /health` after `strata migrate`
- Notes table on every kit
- Cookie kits: `users` + `sessions`, HTML `/login`, seed `demo@example.com` / `password`
- Token kits: `POST /api/v1/auth/login` returns an opaque Bearer (SPA scaffold uses this)
- JWT kits: `POST /api/auth/token` mints a short-lived HS256 token
- Hybrid/SPA: `mergeSpaRoutes` under `SPA_PREFIX`
- `strata.layers.json` records the choices

`APP_ENV=production` calls `assertProductionSecrets()` on boot.

## HiroApp: too late to regenerate

HiroApp already has hiring modules, Eloquent models, migrations, MFA, SCIM, and two sidecars. Replacing `apps/hiroapp` with a starter output would break that tree.

Use the hiring recipes (`hiroapp-hobby` ... `hiroapp-enterprise`) for **new** apps. Treat HiroApp as the reference implementation, not as a target for `create-strata`.

## In this repo

`strata new my-app --kit hobby --yes` calls the same generator. `strata new --frontend=hybrid` (no project name) still overlays HTML/SPA files into the current directory.
