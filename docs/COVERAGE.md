# Coverage policy

CI enforces **100% lines on in-scope files** via `scripts/assert-core-coverage.ts` (`bun run test:coverage`) and `scripts/assert-hiroapp-coverage.ts` (`bun run test:hiroapp:coverage`). Bun’s `coverageThreshold` is not used: OpenAPI/CLI tests load HiroApp `createApp`, so one process scores both trees. Ignore lists stay in `bunfig.toml` (`coveragePathIgnorePatterns`) and the assert scripts.

## Why scoped coverage?

| In scope | Out of scope (integration-tested instead) |
|----------|-------------------------------------------|
| Module domain logic (`service`, `repository`, `policy`, JSON `controller`) | Route tables, DTOs, `requests.ts`, `resources.ts`, `table.ts` |
| Core auth, tenant, security, validation, audit | HTTP middleware stack, views, web controllers |
| Queue **job handlers** and domain services | Queue/redis transport wiring, cache/mail/storage drivers |
| Shared database helpers | CLI, migrations, bootstrap wiring, config schema |

**Rationale:** Business rules and security-sensitive code get strict unit coverage. Boilerplate routing, env wiring, and infrastructure glue are exercised by integration and smoke tests without forcing 100% on thin wrappers.

## Commands

```bash
# Full gated suite (matches CI)
bun run test:coverage
bun run test:hiroapp:coverage

# Find in-scope files below 100%
bun test --coverage 2>&1 | rg "^\s+src/" | rg -v "100\.00 \|  100\.00"
```

Configuration lives in `bunfig.toml` → `coveragePathIgnorePatterns`. See also [TESTING.md](./TESTING.md) for tenant DB scope and Docker parity.

## CI

CI runs leftover WorkHub `src/db` migrate/seed (for core tests that inspect `tenant` RLS), then HiroApp `migrate:fresh --seed`, then `test:coverage`, then `test:hiroapp:coverage`. Failing any in-scope file blocks merge.

## Adding new code

1. **Domain logic** in an in-scope path → add unit tests until that file hits 100%.
2. **New route or middleware** → add or extend an integration test under `tests/integration/`.
3. **New public framework API** → export from `src/framework/public-api.ts` and extend `tests/unit/frameworkPublicApi.test.ts`.

If you believe a file should move between in-scope and out-of-scope, update `bunfig.toml` and document the reason in a PR — do not silently widen exclusions.
