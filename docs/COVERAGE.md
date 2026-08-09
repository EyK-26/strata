# Coverage

CI requires **100% lines on in-scope files** through `scripts/assert-core-coverage.ts` (`bun run test:coverage`). That is not 100% of `src/`. Ignore lists in `bunfig.toml` and `scripts/assert-core-coverage.ts` drop whole trees (`src/core/http/**`, `src/bootstrap/**`, `src/core/auth/guard.ts`, and others). New files under those globs are excluded unless you take them off the list.

Do not set Bun `coverageThreshold`. OpenAPI and CLI tests load HiroApp `createApp`, so one process would score both trees and fail a naive 100% gate.

## Why scoped coverage?

| In scope | Out of scope (integration-tested instead) |
|----------|-------------------------------------------|
| Module domain logic (`service`, `repository`, `policy`, JSON controller) | Route tables, DTOs, `requests.ts`, `resources.ts`, `table.ts` |
| Core auth helpers, tenant, security, validation, audit | HTTP middleware stack, views, web controllers |
| Queue **job handlers** and domain services | Queue/redis transport wiring, cache/mail/storage drivers |
| Shared database helpers that are not ignored | CLI, migrations, bootstrap wiring, config schema |

Business rules and security-sensitive code get strict unit coverage. Thin routing and env wiring are exercised by integration and smoke tests.

`src/core/database/dialect.ts`, JWT helpers, Basic auth, and token abilities are in scope. `src/core/http/` and `src/core/auth/guard.ts` are ignored because they are covered through request tests.

## Commands

```bash
bun run test:coverage
```

Configuration: `bunfig.toml` → `coveragePathIgnorePatterns`. See [TESTING.md](./TESTING.md).

## CI

CI migrates the fixture schema (core RLS tests), then HiroApp, then the core coverage gate. Any in-scope file below 100% lines blocks merge.

## Adding new code

1. Domain logic in an in-scope path: add unit tests until that file is 100% lines.
2. New route or middleware: extend framework request tests or a generated example app.
3. New public framework API: export from `src/framework/public-api.ts` and extend `tests/unit/frameworkPublicApi.test.ts`.

If a file should move between in-scope and out-of-scope, update `bunfig.toml` and `scripts/assert-core-coverage.ts` and say why in the PR. Do not silently widen exclusions. Prefer adding a new security-sensitive file to the in-scope set (remove it from the ignore list) rather than putting it under an ignored glob.
