# Strata

Strata is a Bun framework for TypeScript HTTP apps. You pick one database, one auth style, and HTML, JSON, or both.

## Create an app

You need [Bun](https://bun.sh) 1.4.x.

```bash
bunx create-strata my-app
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

`strata` installs into the app rather than globally, so use the `bun run` scripts above, or `bunx strata <command>` from inside the app directory.

The wizard asks each layer (frontend, database, auth, tenancy, cache, queue, mail, extras). In a terminal, move with arrow keys and Enter, or type a number. `--docker` with Postgres or MySQL also writes Adminer at http://localhost:8080.

```bash
bunx create-strata my-app --yes
bunx create-strata html --frontend server-htmx --database postgres --auth cookie --cache redis --queue redis --docker --yes
```

Guides: [docs/STARTER.md](docs/STARTER.md), [docs/BUILDING-APPS.md](docs/BUILDING-APPS.md), [docs/AUTH.md](docs/AUTH.md), [docs/DATABASE.md](docs/DATABASE.md), [docs/TENANCY.md](docs/TENANCY.md).

## Packages

Published as **1.0.3**:

| Package | What it is |
|---------|------------|
| `@getstrata/core` | Runtime: auth, HTTP, database, queue, mail, security |
| `@getstrata/bootstrap` | App boot: kernel, providers, cookie session helpers |
| `@getstrata/cli` | `strata` commands: `dev`, `start`, `migrate`, `run` |
| `@getstrata/starter` | The generator, also published as `create-strata` |
| `create-strata` | What `bunx create-strata my-app` resolves |

Application code should import **subpaths**, not the root `@getstrata/core` barrel:

```typescript
import { Policy } from "@getstrata/core/auth/policy";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
```

## Cookie HTML apps

Generated cookie apps include restyleable welcome, login, register, and password reset screens (`views/` plus `public/assets/site.css`). Seed login is `demo@example.com` / `password`. Session cookie name is `strata_session`. CSRF field is `_token`.

## This repository

This repo is the framework source and three generated examples:

| App | Stack |
|-----|--------|
| `apps/hiroapp-hobby` | SQLite JSON API |
| `apps/hiroapp-team` | Postgres HTML, Redis, Adminer |
| `apps/hiroapp` | Postgres HTMX, cookies + tokens + JWT, RLS, Redis, SMTP, extras |

Clone this repo only if you are changing Strata itself. For a product app, use `create-strata`. Contributor setup: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md). Tests: [docs/TESTING.md](docs/TESTING.md). Production: [docs/PRODUCTION.md](docs/PRODUCTION.md).

```bash
cp .env.example .env
docker compose up -d postgres redis --wait
bun install
bun run build:framework
bun run build:bootstrap
bun run hiroapp:fresh
bun run hiroapp:dev
```

Open http://localhost:3000. Host-native Bun against published ports: `bun run dev:host` (see `.env.host.example`).

## Layout

```
apps/hiroapp/           Postgres + HTMX example (generated)
apps/hiroapp-hobby/     SQLite JSON API example (generated)
apps/hiroapp-team/      Postgres HTML + Redis example (generated)
src/core/               Framework runtime
src/bootstrap/          Kernel, providers, cookie sessions
packages/               Published npm packages
templates/              App scaffolds
docs/                   Guides
tests/                  Framework tests
```

## Honest limits

- CI and `apps/hiroapp` use PostgreSQL. `tsMatch` (full-text search) throws on other dialects.
- MySQL and SQLite SQL compilation exists. Query execution against those engines is not a CI guarantee.
- An app picks one primary database. Do not run Postgres and MySQL together as two OLTP stores for the same product.
- `AUTH_DEV_HEADERS=true` is for tests. Production must set it to `false`.
- Published seed tokens such as `strata-admin-test-token` are blocked in production.

## License

MIT. See [CONTRIBUTING.md](CONTRIBUTING.md) if you are changing this repo.
