# Coverage policy

WorkHub enforces **100% lines, functions, and statements per in-scope file** via `bunfig.toml`. This is a **scoped** gate — not every file under `src/` is included.

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

# Find in-scope files below 100%
bun test --coverage 2>&1 | rg "^\s+src/" | rg -v "100\.00 \|  100\.00"
```

Configuration lives in `bunfig.toml` → `coveragePathIgnorePatterns`. See also [TESTING.md](./TESTING.md) for tenant DB scope and Docker parity.

## CI

`validate:ci` runs `test:coverage` after migrate/seed. Failing any in-scope file blocks merge.

## Adding new code

1. **Domain logic** in an in-scope path → add unit tests until that file hits 100%.
2. **New route or middleware** → add or extend an integration test under `tests/integration/`.
3. **New public framework API** → export from `src/framework/public-api.ts` and extend `tests/unit/frameworkPublicApi.test.ts`.

If you believe a file should move between in-scope and out-of-scope, update `bunfig.toml` and document the reason in a PR — do not silently widen exclusions.
