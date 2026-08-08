# Contributing

Thanks for improving WorkHub / 42 API. This project is Docker-first — run commands inside the app container unless noted.

## Prerequisites

- Docker Compose
- Copy `.env.example` to `.env` when running outside compose defaults

## Before you open a PR

Run the full validation suite:

```bash
docker compose exec app bun run validate
```

Or step by step:

```bash
docker compose exec app bun run check      # TypeScript
docker compose exec app bun run lint       # Biome lint + format check
docker compose exec app bun run test:all   # Unit + integration tests
docker compose exec app bun run cli openapi:check  # Committed OpenAPI drift
```

## Git hooks (optional)

After `bun install`, Lefthook installs hooks automatically via the `prepare` script:

- **pre-commit** — Biome format/lint on staged files
- **pre-push** — full `validate` script

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
