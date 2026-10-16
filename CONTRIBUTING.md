# Contributing

Thanks for improving Strata. This project is Docker-first. Run commands inside the app container unless you use the host wrappers (`bun run dev:host`, `bun run validate:host`).

## Prerequisites

- Docker Compose
- Copy `.env.example` to `.env` for in-container runs
- For host-native Bun against published ports: `bun run dev:host` / `bun run validate:host`, or copy `.env.host.example` to `.env.host`

## Before you open a PR

```bash
bun install
docker compose up -d postgres mysql redis --wait
bun run validate:host
```

The complete gate includes unchanged source coverage, all generated-app compiler profiles, packed-package security/HTTP/OpenAPI checks and a native Bun Docker runtime case. Compose provides test infrastructure, not a product application service.

## Git hooks

After `bun install`, Lefthook installs hooks via the `prepare` script:

- pre-commit: Biome format/lint on staged files
- pre-push: `bun run validate:host`

Manual install: `bunx lefthook install`

## Application modules and migrations

Exercise product modules in a generated external app with the published CLI. The root repository CLI only manages deterministic framework fixtures:

```bash
scripts/with-host-env.sh env STRATA_SCHEMA=fixture bun run cli migrate:status
bun run fixture:fresh
```

Never edit an applied migration. Keep regression coverage for upgrades from populated history, not only a fresh schema.

## OpenAPI

The committed document is a generated-app acceptance snapshot, checked against the real packed CLI. Run `scripts/with-host-env.sh bun scripts/verify-generated-runtime.ts --openapi`. The private fixture CLI's two-route map is only a deterministic command/SDK test fixture; do not use it to regenerate that acceptance snapshot. In an external app, run `strata openapi:generate` and `strata openapi:check` from that app's directory.

## Code style

- Biome is the source of truth (`biome.json`)
- Match neighboring files
- Keep optional extras opt-in via `FEATURE_*` env flags. The generator emits working MFA, email verification, and SCIM routes when those extras are selected.
- Import `@getstrata/core/...` subpaths, never the root barrel, from app code

## Tests

- Framework unit: `bun run unit`
- Integration (Postgres/Redis): `bun run integration`
- Add coverage for auth, tenancy, and flags when you touch those areas
- For stateful mechanisms, follow the [regression review flow](docs/TESTING.md#stateful-mechanism-regression-review), including persisted failure/recovery assertions and explicit qualification gaps

## Security

Do not commit secrets. Production blocks published seed tokens. See `src/bootstrap/secretsGuard.ts`.
