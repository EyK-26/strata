# SOLID, Laravel workflow and Bun follow-up

Base: 3.0.5 (`eea049d`). Implementation proceeds in bounded commits on one integration
branch. Preserve application/execution ownership, native transactions and explicit
failure semantics. Compile convenience declarations at startup, not on each query.

| Item | Deliverable | Status |
| --- | --- | --- |
| 1 | Current, executable model workflow documentation | Implemented |
| 2 | Concise model declarations and matching generators | Implemented |
| 3 | Coherent provider authoring over the existing service graph | Implemented |
| 4 | Honest adapter capabilities and narrow consumer ports | Implemented |
| 5 | Bun-backed streaming storage with bounded transfer tests | Implemented |
| 6 | Application-owned extensible notification channels | Implemented |
| 7 | Targeted responsibility extraction with regression tests | Implemented |
| 8 | Qualify Bun-native MySQL; replace only if guarantees pass | Evaluated; retain mysql2 |

Confirmed bugs discovered during implementation are fixed and recorded here.
MySQL qualification may conclude that retaining mysql2 is necessary; native API
availability alone is not proof of equivalent transaction/cleanup semantics.

Validation: focused behavior tests per commit; integrated type/lint/boundary checks;
packed-package consumer verification; native adapter qualification where affected.
No exhaustive starter Cartesian campaign or repeated CI polling. No version bump,
merge or release is included in this implementation window.

## Implementation outcomes

- Model declarations now use `createModel` for the ordinary case, preserving
  `db.model(...)`, explicit registration, observers/scopes and transaction ownership.
  The lower-level repository/model declarations remain available for custom behavior.
- `defineProvider` groups service declarations and orders setup before boot using the
  existing compiled graph and leased scopes. It introduces no mutable global container.
- Mail and storage dependencies use structural ports. Custom cache stores must supply
  atomic tagged loading; unsupported semantics fail explicitly.
- Local and S3 storage expose optional streaming capabilities through Bun APIs.
  Capability checks preserve the manager facade and its overrides.
- Notification dispatch supports an immutable, application-owned channel registry.
  Form requests share authorization and validation orchestration.

## Additional defects fixed

1. Web request parsing selected encoding from response preferences instead of the
   request Content-Type; JSON and form submissions now follow their actual encoding.
2. Non-boolean authorization results could grant access; only literal true grants.
3. Positive integer query parsing accepted partial and unsafe values.
4. Custom tagged cache fallback could attach tags too late to fence an invalidated fill.
5. Notification mail payloads dropped HTML bodies.
6. Database notification keys could become NaN or rounded unsafe integers.
7. MySQL oversized integer results could lose precision. Safe integers remain numbers;
   oversized integers and exact decimals remain strings.
8. Integration review caught streaming capability narrowing bypassing facade overrides;
   the narrowing function now preserves identity and overrides.
9. Model convenience declarations reject invalid names before invoking coercion hooks.

The last two were found while implementing the new APIs. Generator observer fixtures
and safe MySQL ID behavior were also exercised after integration rather than relying
on isolated module checks.

## Native MySQL decision

Run `MYSQL_URL=... bun scripts/qualify-bun-mysql.ts` against a disposable MySQL
instance. On Bun 1.4.4, reserved connections, savepoints, rollback, cancellation,
connection discard isolation and exact numeric values passed. An unchanged UPDATE
reports zero affected rows in Bun SQL but one matched row in the current mysql2
adapter. Keep mysql2 until that public result contract, read-only observation
integration and representative performance are qualified. This is a completed
qualification decision, not a native-driver migration or performance claim.

## Validation and limits

Installed CLI/model generation, UUID migrations, explicit registration and CRUD pass
on SQLite, PostgreSQL and MySQL. Targeted behavior coverage includes provider lifecycle,
notifications, cache invalidation, request parsing and local/native S3 streaming.
The S3 test uses a local HTTP fixture; no production S3 deployment or throughput
benchmark is claimed. Local interrupted streaming writes may leave partial files, as
specified in the storage documentation. No broad ORM rewrite or full starter Cartesian
campaign is part of this increment.

### Reproduction

With the repository's host database fixtures and installed browser available:

```sh
bun run check
bun run lint:ci
bun run check:module-imports
bun run verify:framework
SKIP_FIXTURE_TEST_BOOTSTRAP=1 CACHE_DRIVER=array QUEUE_DRIVER=sync \
  scripts/with-host-env.sh bun run test:coverage
SKIP_FIXTURE_TEST_BOOTSTRAP=1 CACHE_DRIVER=array \
  scripts/with-host-env.sh bun scripts/verify-model-generator.ts
scripts/with-host-env.sh bun scripts/qualify-bun-mysql.ts
```

Set `PLAYWRIGHT_BROWSERS_PATH` when the browser cache is outside the default home.
For the package-specific check, pack the built core package into a fresh consumer
outside this repository, resolve its optional dependencies, and replay
`applicationProviders.test.ts`, `notifications.test.ts` and `storage.test.ts` (plus
its `restoreEnv.ts` helper) there. All their framework imports use public package
subpaths, so the consumer runs without repository path aliases or test preloads.
That check passed 33 tests against the archive. The installed model-generator check
independently verifies all three database drivers through fresh generated apps.
