# Coverage

CI requires **100% lines on enforced files** through `scripts/assert-core-coverage.ts` (`bun run test:coverage`). That is not 100% of `src/`. Exemptions are recorded debt, listed as explicit file paths in `scripts/coverage-baseline.ts`.

Exemptions are per file, not per directory. A new file is enforced by default even when every one of its siblings is exempt, so adding one to the debt list is a visible diff that has to be reviewed.

Do not set Bun `coverageThreshold`. OpenAPI and CLI tests load HiroApp `createApp`, so one process would score both trees and fail a naive 100% gate.

## What the gate checks

| Check | Failure means |
|-------|---------------|
| Enforced file below 100% lines | Add tests until it reaches 100% |
| Enforced file with no coverage row | No test ever imported it, so its coverage is unknown. Import it from a test |
| Exemption for a file that no longer exists | Delete the entry from `coverage-baseline.ts` |
| `COVERAGE_EXEMPT_LIMIT` exceeded | A file was added to the debt list. Test it instead |
| Exemption count below the limit | Lower `COVERAGE_EXEMPT_LIMIT` to lock the win in |

Type-only modules are excluded from the no-coverage-row check. They erase to nothing, so they can never appear in a coverage report.

## The ratchet

`COVERAGE_EXEMPT_LIMIT` in `scripts/coverage-baseline.ts` is a ceiling that may only ever be lowered. The gate fails if the list grows, and also fails if the list shrinks without lowering the limit, so a win cannot be silently given back later.

When an exempt file reaches 100%, the gate prints it as redeemable. Remove its entry and lower the limit in the same PR.

## Keeping the two ignore lists in sync

`bunfig.toml` `coveragePathIgnorePatterns` controls what Bun **reports**. `scripts/coverage-baseline.ts` controls what the gate **enforces**. They must agree.

Taking a file off the exempt list is not enough on its own: if `bunfig.toml` still ignores its path, Bun emits no row for it and the gate reports it as never loaded. Remove it from both.


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

Configuration: `bunfig.toml` → `coveragePathIgnorePatterns` (what Bun reports) and `scripts/coverage-baseline.ts` (what the gate enforces). See [TESTING.md](./TESTING.md).

## CI

CI migrates the fixture schema (core RLS tests), then HiroApp, then the core coverage gate. Any enforced file below 100% lines blocks merge.

## Adding new code

1. Domain logic in an enforced path: add unit tests until that file is 100% lines.
2. New route or middleware: extend framework request tests or a generated example app.
3. New public framework API: export from `src/framework/public-api.ts` and extend `tests/unit/frameworkPublicApi.test.ts`.

To move a file between enforced and exempt, update `bunfig.toml` and `scripts/coverage-baseline.ts` together, adjust `COVERAGE_EXEMPT_LIMIT`, and say why in the PR. Exemptions may only be removed, never added: a new security-sensitive file belongs in the enforced set with tests, not under an ignored glob.
