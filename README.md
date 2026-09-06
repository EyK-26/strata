# Strata

Strata is a Bun framework for building server apps. You write TypeScript. The runtime is Bun. PostgreSQL is the proven database for production. Redis is optional until you need cache, queues, or shared rate limits.

**HiroApp** (`apps/hiroapp`) is the in-repo Postgres + HTMX example, generated from `create-strata`. Sibling examples: `apps/hiroapp-hobby` (SQLite API) and `apps/hiroapp-team` (Postgres HTML + Redis). The original hiring product was removed until it can be rebuilt on that generator. When you want a new app, use [docs/STARTER.md](docs/STARTER.md).

This README is the map. Each linked guide is written for someone who has used HTTP and SQL, but has not used this repo before.

| I want to... | Read this |
|--------------|-----------|
| Run HiroApp on my machine | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| Choose cookie sessions, API tokens, JWT, or Basic auth | [docs/AUTH.md](docs/AUTH.md) |
| Choose PostgreSQL, MySQL, or SQLite | [docs/DATABASE.md](docs/DATABASE.md) |
| Learn the generated example apps | [docs/HIROAPP.md](docs/HIROAPP.md) |
| Start my own app | [docs/STARTER.md](docs/STARTER.md) and [docs/BUILDING-APPS.md](docs/BUILDING-APPS.md) |
| Run tests and coverage | [docs/TESTING.md](docs/TESTING.md) |
| Ship to production | [docs/PRODUCTION.md](docs/PRODUCTION.md) |

## What this framework is (and is not)

Strata gives you:

- HTTP routing, middleware, CSRF, signed URLs, and HTML or JSON responses
- Cookie sessions that store a row in `sessions`, plus named API guards
- A query builder, migrations, models, and repositories
- Queues, cache, mail, storage, and scheduled tasks
- Policies, abilities on tokens, and Postgres row-level security when you need tenants

Strata does not pick your frontend. You can serve server-rendered HTML with HTMX, a React SPA under a prefix, both, or JSON only. The auth and SQL choices are also yours. Pick the strongest option that matches how clients talk to you. See [docs/AUTH.md](docs/AUTH.md).

PostgreSQL is what we run in CI and in the in-repo HTML example. Named connections can attach SQLite or MySQL. Dialect helpers exist so generated SQL can target those engines. An app picks **one** primary database. Do not run Postgres and MySQL together as two OLTP stores for the same product.

## Packages

| Package | What it is |
|---------|------------|
| `@getstrata/core` | Runtime: auth, HTTP, database, queue, mail, security |
| `@getstrata/bootstrap` | App boot: kernel, providers, cookie session helpers |
| `@getstrata/cli` | `strata` commands: `dev`, `start`, `migrate`, `run` |
| `@getstrata/starter` | `bunx create-strata my-app` (interactive layers) |

Import **subpaths**, not the root `@getstrata/core` barrel, from application code:

```typescript
import { Policy } from "@getstrata/core/auth/policy";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
```

CI rejects root-barrel imports in apps.

## Run HiroApp locally

You need Docker for Postgres and Redis, and Bun 1.4.x (CI and Compose use the latest 1.4 patch).

```bash
cp .env.example .env
docker compose up -d postgres redis --wait
bun install
bun run build:framework
bun run build:bootstrap
bun run hiroapp:fresh
bun run hiroapp:dev
```

Open http://localhost:3000. Seeded logins use password `password`:

| Email | Role |
|-------|------|
| `demo@example.com` | member |
| `admin@example.test` | admin |

Host-native Bun against published ports: `bun run dev:host` (see `.env.host.example`).

## Frontend modes

Set `FRONTEND_MODE`:

| Value | What you get |
|-------|----------------|
| `server-htmx` | HTML from Eta templates plus JSON under `/api` |
| `spa-react` | JSON API plus a SPA document under `SPA_PREFIX` (default `/app`) |
| `hybrid` | Staff HTML at `/` plus a SPA prefix (default `/app`) |
| `api` | JSON only |

The in-repo HTML example uses cookie sessions and CSRF. See [docs/AUTH.md](docs/AUTH.md).

## Useful commands

```bash
bun run hiroapp:fresh          # Example app migrate + seed
bun run hiroapp:dev            # Postgres + HTMX example
bun run generate:example-apps  # Rewrite apps/hiroapp* from create-strata
bun run test:coverage          # Framework coverage gate
bun run validate:host          # Full local CI-shaped check
strata migrate                 # App schema (apps/hiroapp when dogfood)
STRATA_SCHEMA=fixture strata migrate:fresh --seed   # Core-test fixture schema only
```

The leftover `src/db` schema is a **fixture** for framework tests (tenants, RLS). It is not a product. Do not add product features there.

## Layout

```
apps/hiroapp/           Postgres + HTMX example (generated)
apps/hiroapp-hobby/     SQLite JSON API example (generated)
apps/hiroapp-team/      Postgres HTML + Redis example (generated)
src/core/         Framework runtime
src/bootstrap/    Kernel, providers, cookie sessions
packages/         Published npm packages
templates/        App scaffolds
docs/             Guides
tests/            Framework tests
```

## Honest limits

- HiroApp and CI use PostgreSQL. `tsMatch` (full-text search) throws on other dialects.
- MySQL and SQLite SQL compilation exists. Query execution against those engines is not a CI guarantee.
- HMAC session cookies without a `sessions` row exist for token-style apps. HiroApp HTML does not use that as its login path. Cookie + CSRF is the browser path.
- `AUTH_DEV_HEADERS=true` is for tests. Production must set it to `false`.
- Published seed tokens such as `strata-admin-test-token` are blocked in production.

## License

MIT. See [CONTRIBUTING.md](CONTRIBUTING.md) if you are changing this repo.
