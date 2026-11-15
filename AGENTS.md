# Working on Strata

## Goal

Provide Laravel-style developer experience with TypeScript and native Bun execution.
A junior developer should find a route, controller, request, policy, model and
migration without learning framework internals first. Follow Laravel conventions
where they fit; do not copy PHP reflection, global facades or extra layers that
weaken ownership, typing or performance. Consult current official documentation
when proposing new parity, and distinguish supported features from proposals.

## Repository map

- `src/core/`: runtime, persistence, auth, HTTP, jobs, storage and media.
- `src/bootstrap/`: application composition, providers, route compilation and startup.
- `src/framework/public-api.ts`: root public API; prefer subpath imports in consumers.
- `packages/`: the five published packages, public entries, CLI and starter renderers.
- `templates/`: selected starter overlays, not a product application.
- `tests/unit`, `tests/integration`, `tests/e2e`, `tests/types`: behavioral and type contracts.
- `scripts/`: build, package, boundary, acceptance, version and coverage checks.
- `src/db/`: private framework fixture schema. Never use it to manage a product database.
- `docs/`: current consumer references. Begin with `README.md` and the relevant guide.

Use `package.json` and `.github/workflows/ci.yml` for current commands. Read the
specific implementation and tests before editing. Avoid loading all docs, logs or
source into context. Do not reconstruct past implementation discussions to infer
current behavior; use code, public contracts and reproducible tests.

## Architectural rules

- Keep ordinary model authoring class-based with inferred attributes and relationship
  methods. Derive default repositories within the owning app. Custom repositories
  remain an extension, not mandatory scaffolding.
- Keep routes and middleware separate from controller actions. Controllers take
  narrow explicit dependencies, not containers or whole bootstrap contexts.
- Resolve database sessions, transactions, identity and tenant state within their
  owned execution. Never retain them in application-lifetime services or model statics.
- Preserve cancellation, cleanup, after-commit effects, rollback and scope expiry.
  A timeout or abort signal alone does not prove that underlying work has stopped.
- Keep authentication, validation, abilities, resource authorization and tenant
  isolation as distinct checks. Preserve middleware order and fail-closed behavior.
- Keep native Bun HTTP/SQL/storage/image paths and optional dependencies lazy.
  Avoid per-request file discovery, reflection, schema introspection or unbounded
  buffering. Use streams with backpressure and cancellation for large transfers.
- Preserve public symbol identity across installed import paths. Follow
  `scripts/core-shared-subpaths.ts` and package export generators; do not patch `dist/`.
- Enforce dependencies with `check:module-imports`. Extend a boundary only for a
  justified new dependency; do not broadly waive checks to make a build pass.
- Generated apps must be usable from published tarballs without repository aliases.
  Update docs, CLI and starter output together when changing application conventions.

## Efficient implementation and checks

Inspect the working tree first and preserve unrelated changes. Prefer small coherent
changes, focused searches and tests. Parallel work should have separate file ownership;
sequence dependent API/generator changes. Do not repeatedly poll CI or regenerate an
exhaustive starter Cartesian product. Use representative profiles plus targeted cases
for the behavior changed, while retaining the required CI gates.

For fixture-free unit tests:

```sh
SKIP_FIXTURE_TEST_BOOTSTRAP=1 bun test tests/unit/<affected-test>.test.ts
bun run check
bun run lint:ci
bun run check:module-imports
```

Database, Redis, browser and installed-app checks need the matching infrastructure:

```sh
docker compose up -d postgres mysql redis --wait
bunx playwright install chromium
scripts/with-host-env.sh bun test tests/integration/<affected-test>.test.ts
bun run validate:host
```

`validate:host` builds packages, resets/seeds the dedicated framework fixture and
runs `validate:ci`. It is not safe to point it at an application database. Keep the
existing reset guards. If using a custom Playwright cache, set
`PLAYWRIGHT_BROWSERS_PATH` consistently during installation and execution.
The root fixture CLI requires `STRATA_SCHEMA=fixture` and development/test settings.

Select checks by risk:

- Public APIs/packaging: build core/bootstrap, cold/shared/standalone import checks,
  export-type verification and an installed consumer. Source aliases are insufficient.
- Starter/CLI: source rendering tests plus the affected installed generated-app flows.
  Regenerate canonical snapshots deliberately and inspect the changes.
- Persistence/auth/tenancy: meaningful real-engine and request tests, including denied
  access, concurrent/persisted failure paths, rollback and recovery where relevant.
- Streams/lifecycle: test cancellation, partial failure, resource release and limits.
- Documentation-only: verify examples, commands and links; do not rerun unrelated
  runtime matrices. Version changes also need pin/lockfile and generated-output checks.

Fix reproducible bugs encountered within scope. Tests should prove behavior or an
invariant, not mirror an implementation. Once affected checks pass, repeat them only
for new edits, failures or unresolved concerns. Never claim a test ran when it did not.
Report skipped, infrastructure-blocked and external-provider checks separately.
Do not bypass hooks or required checks unless the task explicitly authorizes it.

Coverage is per-file: `scripts/assert-core-coverage.ts` requires 100% lines for
enforced files, including new files. `scripts/coverage-baseline.ts` records existing
exemptions and the ratchet; `bunfig.toml` controls reporting. Do not add exemptions
or lower coverage to hide failures. Remove redeemed exemptions from both lists and
lower the ratchet. Do not claim that the gate covers all source files.

## Versions and release preparation

All five package manifests, internal peer ranges, starter pins and expected versions
must move together. Use the repository tool instead of hand-editing only manifests:

```sh
bun run bump <major.minor.patch> --check
bun run bump <major.minor.patch>
bun run verify:versions
bun run release:check
```

Promote relevant Unreleased notes into each package's version section. Explain user
behavior and adoption requirements; omit session transcripts, audit ledgers and test
logs. Keep the lockfile changes produced by the bump tool. Verify generated snapshots
if embedded dependency versions changed. Do not modify release workflows merely to
accommodate an unrelated change.

Before publication, check that the merged release target and npm availability match
using `bun run release:check v<version> --check-npm`. Tagging/publishing is separate
from preparing a bump and requires task authorization. A prepared README/changelog
must not claim the release is already published. Keep run-specific evidence in the
PR/CI, not in permanent public documentation.
