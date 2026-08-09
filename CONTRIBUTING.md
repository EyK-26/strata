# Contributing

Thanks for improving WorkHub. This project is Docker-first — run commands inside the app container unless noted.

## Prerequisites

- Docker Compose
- Copy `.env.example` to `.env` for in-container runs
- For **host-native** Bun against published ports: use `bun run dev:host` / `bun run validate:host` or copy `.env.host.example` to `.env.host`

## Before you open a PR

Run the full validation suite:

```bash
docker compose run --rm -e QUEUE_DRIVER=sync app bun run validate:ci
```

Or inside a running container:

```bash
docker compose exec app bun run validate:ci
```

Equivalent step-by-step:

```bash
docker compose exec app bun run check      # TypeScript
docker compose exec app bun run lint:ci    # Biome lint + format check
docker compose exec app bun run cli openapi:validate
docker compose exec app bun run cli openapi:check  # Committed OpenAPI drift
docker compose exec app bun run test:coverage    # Scoped 100% coverage gate
```

## Git hooks (optional)

After `bun install`, Lefthook installs hooks automatically via the `prepare` script:

- **pre-commit** — Biome format/lint on staged files
- **pre-push** — full `validate:ci` script

Manual install: `bunx lefthook install`

## Adding a module

```bash
docker compose exec app bun run cli make:module invoice
```

Generated modules use `wrapAbility` for mutations. Gate optional features with `isFeatureEnabled()` in `index.ts`. Enforce org scope in services via `membershipScope` helpers.

## Migrations and seeds

```bash
docker compose exec app bun run cli make:migration add_example
docker compose exec app bun run cli migrate:fresh --seed
```

## OpenAPI

Regenerate when routes change:

```bash
docker compose exec app bun run cli openapi:generate
docker compose exec app bun run cli sdk:generate
```

CI fails if `docs/openapi.json` drifts — commit regenerated files.

## Code style

- Biome is the source of truth (`biome.json`)
- Match existing patterns in neighboring files
- Keep enterprise features opt-in via `FEATURE_*` env vars

## Tests

- Unit: `bun run unit`
- Integration (requires Postgres): `bun run integration`
- Add integration coverage for auth, tenancy, and feature-flag behavior when touching those areas

## Security

Do not commit secrets. Production blocks default seed tokens — see `src/bootstrap/secretsGuard.ts`.
