# Contributing

Thanks for improving Strata. This project is Docker-first. Run commands inside the app container unless you use the host wrappers (`bun run dev:host`, `bun run validate:host`).

## Prerequisites

- Docker Compose
- Copy `.env.example` to `.env` for in-container runs
- For host-native Bun against published ports: `bun run dev:host` / `bun run validate:host`, or copy `.env.host.example` to `.env.host`

## Before you open a PR

```bash
docker compose run --rm -e QUEUE_DRIVER=sync app bun run validate:ci
```

Or inside a running container:

```bash
docker compose exec app bun run validate:ci
```

Step by step:

```bash
docker compose exec app bun run check
docker compose exec app bun run lint:ci
docker compose exec app strata openapi:validate
docker compose exec app strata openapi:check
docker compose exec app bun run test:coverage
docker compose exec app bun run test:hiroapp:coverage
```

On the host: `bun run validate:host`.

## Git hooks

After `bun install`, Lefthook installs hooks via the `prepare` script:

- pre-commit: Biome format/lint on staged files
- pre-push: `bun run validate:host`

Manual install: `bunx lefthook install`

## Adding a module

```bash
docker compose exec app strata make:module invoice
```

Gate optional features with `isFeatureEnabled()` in `index.ts`. Put hiring-domain examples in HiroApp, not in the leftover `src/db` fixture.

## Migrations and seeds

HiroApp:

```bash
docker compose exec app bun run hiroapp:fresh
```

Fixture schema (framework tests only):

```bash
docker compose exec app sh -c 'STRATA_SCHEMA=fixture strata migrate:fresh --seed'
```

Never edit an applied migration. Add a new file.

## OpenAPI

When HiroApp routes change:

```bash
DOGFOOD_APP=hiroapp APP_KEY_PREFIX=hiroapp APP_NAME=HiroApp API_PREFIX=/api strata openapi:generate
strata openapi:check
```

CI fails if `docs/openapi.json` drifts. Commit regenerated files.

## Code style

- Biome is the source of truth (`biome.json`)
- Match neighboring files
- Keep enterprise features opt-in via `FEATURE_*`
- Import `@getstrata/core/...` subpaths, never the root barrel, from app code

## Tests

- Framework unit: `bun run unit`
- Integration (Postgres/Redis): `bun run integration`
- HiroApp: `bun run test:hiroapp`
- Add coverage for auth, tenancy, and flags when you touch those areas

## Security

Do not commit secrets. Production blocks published seed tokens. See `src/bootstrap/secretsGuard.ts`.
