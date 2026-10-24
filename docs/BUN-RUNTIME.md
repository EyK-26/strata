# Bun runtime baseline

Strata requires Bun **>=1.4.4**, including future 1.4.x patches. The repository `.bun-version`, CI installation and framework/generated Docker stages pin the specifically qualified **1.4.4** release. Package engines and the executable characterization scripts accept later compatible patches; deliberate pin upgrades still require validation. Runtime/type requirements use the same minimum, including `@types/bun` and the transitive `bun-types` override in framework and generated frontend manifests/lockfiles.

## Native PostgreSQL qualification

Official Bun 1.4.4, revision `38afee6c84fcf48c0edb2466aa4b27d287a59c30`, was tested on macOS arm64 using the unchanged SQL timer qualification matrix previously held outside main. All **17 cases passed**, with zero failures/skips, against a disposable PostgreSQL 17 server. Both raw `Bun.SQL` and the public `createBunSqlPool` retained the same backend during quiet transactions, reservations and in-flight statements across idle/lifetime deadlines; idle unreserved connections still retired. A separate public-factory transaction stayed open beyond the actual 30-second default and committed successfully. No production timer defaults, leases, write retries or SQL driver mechanisms were changed.

The executable regression is `tests/integration/bunSqlTimers.integration.test.ts`, using only SELECTs and owned pools. It requires an explicit test database connection and closes pools in `finally`. Run it with the existing fixture environment:

```sh
scripts/with-host-env.sh env SKIP_FIXTURE_TEST_BOOTSTRAP=1 \
  bun test --isolate --max-concurrency=1 tests/integration/bunSqlTimers.integration.test.ts
```

The new native result qualifies this timer matrix on the stated runtime/platform. It does not retroactively change historical 1.4.3 evidence, qualify every managed-provider/pooler or operating-system combination, establish the remaining M1 native-assets contract, or authorize shop adoption. **The manual #257 shop hold remains in place.**

## Existing applications

Installing a framework package does not rewrite an app's `.bun-version`, Dockerfile, package engine/type requirements or frontend lockfile. Adopt those changes explicitly and run that application's tests before deployment. New generated applications receive the updated pins and minimums. The separate application involved in the provisioning investigation was not changed as part of this work.

Bun's [1.4.4 release notes](https://bun.sh/blog/bun-v1.4.4) describe the upstream active-connection timer corrections. The local real-database regression, rather than the version string alone, supplies the qualification evidence. Historical qualification JSON and changelog entries retain the versions actually tested at the time.
