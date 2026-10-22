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

Guides: [docs/STARTER.md](docs/STARTER.md), [docs/BUILDING-APPS.md](docs/BUILDING-APPS.md), [docs/AUTH.md](docs/AUTH.md), [initial admin](docs/INITIAL-ADMIN.md), [docs/DATABASE.md](docs/DATABASE.md), [docs/TENANCY.md](docs/TENANCY.md).

## Packages

Published as **2.2.50**:

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

Generated cookie apps include restyleable welcome, login, register, and password reset screens (`views/` plus `public/assets/site.css`). Seed login is `demo@example.com` / `StrataDemo!ChangeMe`. Session cookie name is `strata_session`. CSRF field is `_token`.

## This repository

This repository contains framework packages and their tests. Product dogfood lives in [strata-shop](https://github.com/EyK-26/strata-shop), which consumes published packages. Acceptance tests generate disposable apps, install candidate tarballs and exercise their real CLI, security, HTTP, OpenAPI and Docker behavior. The legacy application directories have been removed after their assertions were transferred to generated acceptance and historical migration fixtures.

Clone this repo to change Strata itself. For a product, use `create-strata` and its generated README/Dockerfile.

```bash
bun install
docker compose up -d postgres mysql redis --wait
bun run validate:host
```

The root CLI is a private framework fixture harness. Database operations require `STRATA_SCHEMA=fixture` and a development/test environment; generated apps use their own published `strata` CLI. Run `bun run verify:generated-runtime` through `scripts/with-host-env.sh` for isolated HTTP/OpenAPI acceptance. `bun run test:e2e` also qualifies the generated Docker image with an owned database/container. See [testing](docs/TESTING.md) and the [retirement evidence](docs/GENERATED-APP-ACCEPTANCE.md).

## Layout

```
src/core/               Framework runtime
src/bootstrap/          Kernel, providers, cookie sessions
packages/               Published npm packages
templates/              App scaffolds
docs/                   Guides
tests/                  Framework tests
```

## Honest limits

- RLS acceptance uses PostgreSQL; supported mechanisms also run against SQLite and MySQL. `tsMatch` (full-text search) throws on other dialects.
- MySQL and SQLite SQL compilation exists. Query execution against those engines is not a CI guarantee.
- An app picks one primary database. Do not run Postgres and MySQL together as two OLTP stores for the same product.
- `AUTH_DEV_HEADERS=true` is for tests. Only that exact string enables header auth. Production must set it to `false`.
- Production secret checks also run when `NODE_ENV=production` or `APP_ENV` is an unrecognized value. Do not derive JWT or session secrets from the app name.
- The coverage gate is 100% of in-scope files, not all of `src/core`. See [docs/COVERAGE.md](docs/COVERAGE.md).
- Published seed tokens such as `strata-admin-test-token` are blocked in production.

## License

MIT. See [CONTRIBUTING.md](CONTRIBUTING.md) if you are changing this repo.
