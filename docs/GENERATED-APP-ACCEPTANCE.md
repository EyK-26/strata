# Replacing checked-in dogfood apps with generated acceptance fixtures

Strata owns framework mechanisms, generator output and their pre-release acceptance tests. [strata-shop](https://github.com/EyK-26/strata-shop) is the external product dogfood and consumes published packages. Its commerce rules and Postgres-only deployment do not replace framework dialect, feature-combination or package acceptance.

## First PR: preserve the security suite

`bun run test:e2e` now generates an external temporary server-HTMX/Postgres/RLS/cookie-token-JWT app with MFA, verification, SCIM and metrics. It installs the candidate core/bootstrap/cli tarballs, explicitly installs the optional SAML peer at the framework lockfile-installed version exercised by the suite, migrates and explicitly seeds an owned database, and boots the generated runtime with the restricted `strata_app` role. It never copies or imports `apps/hiroapp`. The two RLS-context probes resolve the same packed package instance used by the app; importing the monorepo's source alias would test a separate connection/context registry.

The former `tests/e2e/hiroapp.security.test.ts` is moved to `tests/e2e/generatedApp.security.test.ts`. Its 23 test names and 116 static assertion statements are unchanged from `ed98f3b32d32ebc2827a87cd9d32676c73f633cb`; both baseline and generated-app runs execute 115 assertions, with 23 passes, zero failures and zero skips. A TypeScript AST/printer comparison confirms identical ordered test names and assertion statements (normalized SHA-256 `6d9b9be8d01cbe206aaf72b2d72606fb5a4b382ae5780953e8026b6d8ffa3618`). The static/runtime counts differ because a conditional assertion branch is not selected in this configuration; no assertion was removed.

The first generated run failed 4 cases: three tenant fixture inserts depended on old app-owned `plan`/`region` columns absent from the current generic generated tenant schema, and SAML depended on the monorepo's optional peer. The fixture inserts now write the same tenant slugs without those unrelated columns, and the test app explicitly installs the SAML peer. Security expectations, response contracts, RLS grants/denials, signatures and replay checks are unchanged. The corrected generated run passes all 23 cases and 115 assertions. This is a harness migration, not a framework mechanism workaround.

The app context and pools close before the owned database is dropped and the temporary installation is removed. Failed setup also retains a cleanup path. Existing HiroApp databases, application directories and smoke/OpenAPI wiring remain in this PR. The helper fails rather than skipping when required infrastructure or installation is unavailable.

`validate:ci` includes `test:e2e` after the existing core coverage gate; both main CI and the release workflow use that command. The old duplicate main-CI invocation is removed. The coverage file scope, exemption ceiling, enforced-file line threshold and existing generated-app compiler matrix are unchanged. Packed-app security acceptance is a separate runtime gate; its assertion count is not a claim of source line coverage.

## Removal gates and subsequent focused PRs

1. Replace the remaining checked-in-app boot/OpenAPI/HTTP smoke dependencies with generated temporary fixtures. Preserve the current route inventory, API-only scope assertions, built SPA checks, integration extras and executable Docker behavior. Review root CLI/bootstrap dispatch, module preloads, test setup and environment helpers; do not change the published app CLI contract to emulate an in-repo demo.
2. Once those replacements pass, remove `apps/hiroapp`, `apps/hiroapp-hobby` and `apps/hiroapp-team`, their workspace/lockfile/Docker copies and obsolete special-case selectors. Reconcile the example presets, regeneration scripts, coverage exclusions and documentation by actual dependency, not by deleting every filename containing HiroApp. For example, the model parity unit suite is synthetic framework coverage and must survive the removal even if renamed.
3. Keep small deterministic framework fixtures and the SQLite/MySQL/Postgres generated-app matrix. Keep the external shop independent of framework checkout layout. Run all existing package/export, generator/type, unit/integration, E2E, smoke, coverage and release gates before claiming removal complete.

The checked-in apps must remain until their remaining executable gates have replacements. Local generated-app acceptance does not qualify external providers, shop capacity, a 24-hour soak, production recovery or independent security review.

## Validation of the first migration

The complete host gate passes 2,348 unit/integration tests, zero failures and three unchanged engine/platform skips, followed by all 23 E2E cases/115 executed assertions without skips. The core coverage gate remains 136 enforced files and 274 exemptions. All six generated layer combinations compile on TypeScript 5.9.3, 6.0.3 and 7.0.2; package/export/release checks and the unchanged 40-route API-only OpenAPI validation/check pass. The checked-in app boot/OpenAPI/HTTP smoke gates and all three app directories remain required until the subsequent removal steps are qualified. No production runtime, package version or framework public API is changed by this first PR.
