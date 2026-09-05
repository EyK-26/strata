# Strata

Strata is a Bun framework for building server apps. You write TypeScript. The runtime is Bun. PostgreSQL is the proven database for production. Redis is optional until you need cache, queues, or shared rate limits.

**HiroApp** (`apps/hiroapp`) is the only in-repo example product. It is a hiring OS: public careers, applications, interviews, offers, staff tools. When you want to see how a Strata feature is meant to be used, look there.

This README is the map. Each linked guide is written for someone who has used HTTP and SQL, but has not used this repo before.

| I want to... | Read this |
|--------------|-----------|
| Run HiroApp on my machine | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| Choose cookie sessions, API tokens, JWT, or Basic auth | [docs/AUTH.md](docs/AUTH.md) |
| Choose PostgreSQL, MySQL, or SQLite | [docs/DATABASE.md](docs/DATABASE.md) |
| Learn HiroApp as a product and as a teaching app | [docs/HIROAPP.md](docs/HIROAPP.md) |
| Start my own app | [docs/BUILDING-APPS.md](docs/BUILDING-APPS.md) |
| Run tests and coverage | [docs/TESTING.md](docs/TESTING.md) |
| Ship to production | [docs/PRODUCTION.md](docs/PRODUCTION.md) |

## What this framework is (and is not)

Strata gives you:

- HTTP routing, middleware, CSRF, signed URLs, and HTML or JSON responses
- Cookie sessions that store a row in `sessions`, plus named API guards
- A query builder, migrations, models, and repositories
- Queues, cache, mail, storage, and scheduled tasks
- Policies, abilities on tokens, and Postgres row-level security when you need tenants

Strata does not pick your frontend. HiroApp uses server-rendered HTML with HTMX. You can serve a React SPA, or a JSON API only. The auth and SQL choices are also yours. Pick the strongest option that matches how clients talk to you. See [docs/AUTH.md](docs/AUTH.md).

PostgreSQL is what we run in CI and in HiroApp. Dialect helpers exist so generated SQL can target MySQL or SQLite. Those runtimes are not proven in this repo. Do not pretend they are.

## Packages

| Package | What it is |
|---------|------------|
| `@getstrata/core` | Runtime: auth, HTTP, database, queue, mail, security |
| `@getstrata/bootstrap` | App boot: kernel, providers, cookie session helpers |
| `@getstrata/cli` | `strata` commands: `dev`, `start`, `migrate`, `run` |
| `@getstrata/starter` | `bunx @getstrata/starter my-app` |

Import **subpaths**, not the root `@getstrata/core` barrel, from application code:

```typescript
import { Policy } from "@getstrata/core/auth/policy";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
```

CI rejects root-barrel imports in apps.

## Run HiroApp locally

You need Docker for Postgres and Redis, and Bun 1.4+.

```bash
cp .env.example .env
docker compose up -d postgres redis --wait
bun install
bun run build:framework
bun run build:bootstrap
bun run hiroapp:fresh
bun run hiroapp:dev:htmx
```

Open http://localhost:3000. Seeded logins all use password `password`:

| Email | Role |
|-------|------|
| `admin@hiroapp.com` | Admin (`role_id=1`) |
| `recruiter@hiroapp.com` | Recruiter (`role_id=3`) |
| `candidate@hiroapp.com` | Candidate (`role_id=2`) |

A candidate is a `User` with `role_id = 2`. There is no separate Candidate model.

Host-native Bun against published ports: `bun run dev:host` (see `.env.host.example`).

## Frontend modes

Set `FRONTEND_MODE`:

| Value | What you get |
|-------|----------------|
| `server-htmx` | HTML from Eta templates plus JSON under `/api` (HiroApp default for local UI) |
| `spa-react` | JSON API plus a SPA document |
| `api` | JSON only |

HiroApp HTML uses cookie sessions and CSRF. Partner integrations use Bearer tokens or JWT. See [docs/AUTH.md](docs/AUTH.md).

## Useful commands

```bash
bun run hiroapp:fresh          # HiroApp migrate + seed
bun run hiroapp:dev:htmx       # HiroApp HTML UI
bun run test:hiroapp           # HiroApp tests
bun run test:coverage          # Framework coverage gate
bun run validate:host          # Full local CI-shaped check
strata migrate                 # App schema (HiroApp when DOGFOOD_APP=hiroapp)
STRATA_SCHEMA=fixture strata migrate:fresh --seed   # Core-test fixture schema only
```

The leftover `src/db` schema is a **fixture** for framework tests (tenants, RLS). It is not a product. Do not add product features there.

## Layout

```
apps/hiroapp/     Hiring OS (the example product)
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
