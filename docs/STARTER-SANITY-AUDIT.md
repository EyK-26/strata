# Starter sanity audit — published 2.2.45

Audit date: 2026-10-19. Framework source: merged `5d6d5b62e364628a98c8aa3c7cfe04585f3a74ee`. Runtime reproductions used exact `create-strata@2.2.45` from npm and explicitly verified installed core/bootstrap/CLI 2.2.45 in disposable applications under `~/perso`. The existing user application and the shop were not edited. This is a versioned baseline, not a claim that all supported applications are qualified.

**Released resolution:** [2.2.46](https://github.com/EyK-26/strata/releases/tag/v2.2.46) passed all 88 exact-published runtime scenarios. See [the final qualification below](#published-2246-qualification) and [its machine-readable results](qualification/starter-2.2.46-runtime.json). The earlier sections retain the original failures and candidate states chronologically.

## Why the previous green gate was insufficient

The existing 15 authentication journeys exercise the backend directly. Their fixture provisions owned databases, supplies configuration, chooses array cache/synchronous queues, and provides an isolated ready SMTP service. They prove meaningful auth behavior and remain required, but do not prove the generated React client's behavior or the literal first-install instructions.

The two Adminer tests also supplied an acceptance-only authenticated database readiness override. That allows them to test actual profile startup and login reliably, but cannot prove the generated Compose readiness contract. Full fresh migration tests did not isolate a later billing batch or reset after a completed initial-admin claim.

Keep every existing assertion. Add acceptance at the missing boundaries rather than treating generator string assertions, backend requests, TypeScript checks or a successful HTML response as proof of browser functionality.

## Newly executed structural audit

All 2,688 valid combinations were generated successfully: four frontends × six auth stacks × seven database/tenancy pairs × extras off/all applicable extras on × two cache drivers × two queue drivers × two mail drivers. The database/tenancy pairs are SQLite none/column, MySQL none/column and Postgres none/column/RLS; unsupported RLS coercion is outside this count.

Checks compared emitted environment, driver dependency, selected services, auth model presence and frontend presence against independent expected choices. For all 336 distinct frontend/database/tenancy/auth/extras shapes, 16,536 emitted TypeScript/TSX source files were parsed and relative imports checked. Infrastructure variants were checked for environment/Compose consistency, not separately typechecked or runtime-qualified.

Result: 2,688 structural passes, zero structural failures. The permanent native Bun test passed with 56,107 expectations; TypeScript checking also passed. [Machine-readable results](qualification/starter-2.2.45-structure.json).

This is not exhaustive extras-subset testing, runtime execution of all 2,688 configurations, or proof that generated UI behavior works. Existing packed-app compiler profiles and runtime journeys remain separate evidence.

## Confirmed runtime defects

1. **React auth/client mismatch — [#263](https://github.com/EyK-26/strata/issues/263).** The unchanged generated client succeeds for cookie auth. For token auth, login returns a token but the client discards it and profile loading returns 401. JWT calls the cookie/token login path and gets 404. Header auth calls an absent CSRF endpoint and gets 404. These were real generated-client calls through a same-origin fetch/cookie adapter, not a mounted React browser test. The shared AuthContext also ignores bearer responses. Default header auth is development-only; fixing its UI must not enable production identity headers.

2. **Custom SPA prefix — [#264](https://github.com/EyK-26/strata/issues/264).** A generated `/workspace/` SPA returns HTML 200, but the real built CSS and JS use `/app/` and both return 404. React's basename, frontend build and dev/preview routes hard-code `/app`. The built assets and source basename were checked; interactive browser history/dev-server behavior still needs dedicated regressions.

3. **Fresh Compose readiness — [#265](https://github.com/EyK-26/strata/issues/265).** Fresh MySQL startup followed by the emitted install/migrate steps failed with `PROTOCOL_CONNECTION_LOST`. The same app subsequently passed once authenticated SQL was ready. Only host ports and matching environment ports changed for isolation; no healthcheck/readiness override was added before recording the initial result. Postgres passed its initial literal startup in this run, which does not establish absence of a readiness race.

4. **Initial-admin claim blocks local fresh — [#266](https://github.com/EyK-26/strata/issues/266).** Published initial-admin provisioning succeeded in a new SQLite/no-tenancy app. Explicit local fresh then failed with `Cannot discard a completed initial-admin provisioning claim.` The generated down ignores the framework's destructive-fresh context. Staging correctly rejected fresh and must continue doing so. Ordinary rollback must still preserve the claim.

5. **Billing rollback is incomplete — [#267](https://github.com/EyK-26/strata/issues/267).** Billing was installed as a later SQLite/column-tenancy migration batch using the generated migration. Its generated rollback succeeded, but reapplication failed because `tenant.stripe_customer_id` remained. A whole-schema fresh masks this because tenant is dropped later. Other engines require the same later-batch regression before accepting the fix.

[Machine-readable runtime outcomes](qualification/starter-2.2.45-runtime.json) preserve successes and failures. Initial failures must not be overwritten by a successful retry.

## Positive runtime evidence from this audit

- Plain migration created no users in each newly generated account-auth SQLite app; demo data appeared only after explicit seed.
- Published cookie React API client completed login/profile with the demo account after explicit seed.
- After database readiness, MySQL and Postgres each passed migrate, repeated migrate, fresh, migrate with seed, fresh with seed, and another migrate.
- Staging rejected explicit fresh before destructive work.
- All owned Compose containers, networks and volumes were removed; disposable app directories were removed. No shared services were reset.

The prior 2.2.45 gate also remains valid within its scope: 2,408 unit/integration passes, three existing platform-driver skips, zero failures; 52 E2E passes without skips, including 15 auth journeys and two Adminer logins; unchanged coverage enforcement; package/compiler checks; exact published Adminer and 15-profile auth acceptance. Those results do not negate these newly reproduced failures.

## Focused fix order and acceptance

1. **Fresh-install readiness:** real authenticated healthchecks in generated services and a documented wait contract. Test empty volumes, service failure/timeouts, optional Adminer, and Redis/mail combinations. Keep production migration execution separate. No arbitrary sleeps or app-level retry workaround.
2. **Migration lifecycle:** use the existing rollback guard for the admin claim, reverse billing-owned columns through the schema API, and test later-batch rollback/reapply plus local reset after provisioning on all three engines. Verify staging/production refusal and ordinary rollback protection before accepting.
3. **SPA prefix:** one explicit prefix contract for server, build, router and dev/preview. Verify actual assets, default/custom/nested prefixes, nested history requests and collision rejection in SPA/hybrid. A 200 HTML probe alone is insufficient.
4. **SPA auth:** generated client transport must match the selected auth stack. Define bearer lifetime/persistence and local header identity UI explicitly; do not silently coerce selections, enable production headers, or introduce persistent browser token storage as a shortcut. Cover actual UI login/profile/logout, revoked/expired credentials and MFA challenges.

Each fix gets a failing regression at its real boundary, then a focused framework change, full existing checks and published-package acceptance. Do not bump the shop to hide generated starter defects. Shop adoption remains held for native Bun qualification [#257](https://github.com/EyK-26/strata/issues/257).

## Remaining qualification boundaries

This audit did not mount React in a real browser, execute every extras subset, test every Docker/Local/Mix subset at runtime, or qualify every engine/auth/frontend combination in production/staging. It did not perform real external Stripe/SSO provider qualification, distributed capacity qualification, or native Bun timer acceptance. Existing focused fixtures cover parts of those contracts; none is inferred from the structural matrix. Track these boundaries explicitly as follow-up acceptance, not implicit passes.


## Additional browser boundaries found during the fixes

The original baseline did not mount React. The new browser regression initially passed all six cookie/combined-mode built journeys and failed the six pure token/JWT/header journeys across SPA and hybrid. The fixed client then reached additional real boundaries:

- [#272](https://github.com/EyK-26/strata/issues/272): native dev proxy account writes returned a real 403 because the proxy discarded the browser-facing Host. Preserve Host and Origin together; retain CSRF, cross-site refusal and explicit CORS policy.
- [#274](https://github.com/EyK-26/strata/issues/274): hybrid cookie MFA setup returned 404 because JSON cookie account management was emitted only for API/SPA frontends. Hybrid needs additive JSON endpoints alongside its preserved HTML routes, sharing existing confirmation, hashing, signing and recovery helpers.
- [#275](https://github.com/EyK-26/strata/issues/275): all four header built/dev resource journeys returned 500 when application code used `AuthManager.requireUser`. The generated partial manager lacked the method. Register the complete published `AuthManager` and `GuestGuard`, retaining explicit dev-header gating and fail-closed server policy.

The expanded browser regression has 29 registered scenarios: all six auth selections in both SPA and hybrid, built and native dev-proxy entrypoints (24), two JWT expiry scenarios, and three hybrid cookie-combination MFA/recovery scenarios. It tests actual server rejection of expired/disabled credentials, UI invalidation, authenticated ETag requests, memory-only bearer lifetime, header-disabled refusal, cross-site refusal, logout, and real execution of the ORM module example displayed in the starter. No password, token, CSRF, MFA or ORM mechanism is mocked or reimplemented. Native test orchestration and an isolated browser bridge remain test fixtures.

The initial 6/6 browser baseline, dev 403, hybrid MFA 404 and expanded 25-pass/4-header-failure evidence were retained locally before the final 29-pass run. Full-suite and published-package qualification remain required; focused browser success alone does not resolve the production/externally deployed boundaries listed above.

## Candidate SPA-prefix regression coverage

The focused #264 fix adds a shared validated namespace and exercises both React frontends at `/app`, `/workspace` and `/team/portal`. Each scenario runs the literal generated install/build/dev/preview scripts, fetches real JS/CSS with content-type checks, checks nested history requests and API isolation, and checks that private configuration is absent from bundles. A separate nested-prefix scenario builds the generated Docker frontend stage. Candidate-only archives are copied into its build context; published acceptance uses the unmodified Dockerfile and npm dependencies.

These are document/asset/server assertions, not a claim of mounted React navigation coverage. The separate #263 browser journey work supplies that missing boundary. Original 2.2.45 failures above remain the published baseline until the cumulative release is qualified.

## Cross-engine browser follow-up before release

The integrated candidate passed 2,416 unit/integration tests (the same three platform-driver skips) and 112 E2E tests without E2E failures/skips. Those browser cases used SQLite without tenancy. Five additional risk-based browser profiles were then added: MySQL hybrid/combined/column/dev/MFA, MySQL SPA/token, Postgres hybrid/cookie/RLS/dev/MFA, Postgres SPA/JWT/column, and SQLite hybrid/header/column/dev.

Postgres RLS passed. The Postgres column failure was a fixture error: the administrative model update passed an integer to a boolean column. A typed boolean works through the SQLite binding too, so the fixture now uses a boolean uniformly; the Postgres column journey passed without a framework change.

Two mechanism failures remain release blockers: [#276](https://github.com/EyK-26/strata/issues/276) (MySQL provisioning ignores the separate migration credential and tries CREATE DATABASE as the limited runtime user), and [#277](https://github.com/EyK-26/strata/issues/277) (guest-source header tenancy queries a users table that header apps deliberately omit). Keep the cumulative release on hold, fix these in focused framework changes, and rerun every native case. Do not grant runtime DDL, create fake account tables, or weaken the failing assertions.


## Candidate separate-credential MySQL acceptance

Additional limited-runtime browser qualification exposed [#276](https://github.com/EyK-26/strata/issues/276). Both generated provisioning and the MySQL migration wrapper used runtime credentials despite a supplied administrative migration URL. The fix selects the explicit administrative credential for schema work, scopes it through the published connection API and closes it after success/failure; runtime privileges and production/staging no-provision defaults remain unchanged.

New native cases execute real generated MySQL none/column apps with distinct schema and runtime credentials. They cover migrate, status, credential-state rollback refusal, a reversible later migration batch, fresh/reapply/seed, actual ORM reads, denied runtime DDL, and connection restoration after a failing migration callback. Status and rollback use the existing generated entrypoints; no new public CLI command is assumed. Original limited-role failures are retained before the passing candidate run.


## Candidate identity and tenant-example corrections

The two additional release blockers above were fixed in focused framework changes. MySQL schema work now honors the separate migration credential without widening runtime grants. Header starters register the full AuthManager; named GuestGuard proofs retain their guest credential source, do not query an absent users table, and follow the existing trusted-host/development-header tenant policy. Actual authenticated development-header writes are allowed only with strict AUTH_DEV_HEADERS=true outside staging/production. Anonymous, session-CSRF, disabled-header and untrusted-browser checks remain enforced. The unchanged full identity gate passed 2,448 unit/integration tests, the same three platform-driver skips, and 89 E2E tests without failures or E2E skips.

A second-tenant browser fixture then reproduced #280: the welcome page's unscoped notes example exposed rows in column mode. The displayed example now explicitly uses the public tenant context and typed ORM predicate, with a bounded result size. The browser harness compiles and executes exactly the text displayed on the page, performs authenticated client writes, and checks visibility and tenant isolation. Column-mode context is not implicit query authorization; no framework query semantics changed.

There are now 34 mounted browser scenarios: the original 29 plus the five cross-engine/tenant profiles listed above. The original failures and the intermediate passing totals are historical evidence, not substitutes for the final integrated gate. Exact published-package qualification remains pending the cumulative 2.2.46 release; the structural Cartesian matrix is not a claim that all 2,688 combinations were run in a browser. Shop adoption remains independently held on Bun qualification #257.


The first final integrated run passed all 2,450 unit/integration tests (the same three platform-driver skips) and 122 of 123 E2E scenarios. The remaining readiness failure was traced to the fixture replacing `localhost:3306` and then matching the prefix of its own allocated `127.0.0.1:33060` result, producing invalid port `330600`. A deterministic regression retains that exact case and longer-port non-matches for MySQL/Postgres/Redis; single-pass bounded substitution fixes the fixture without changing generated configuration or readiness assertions. All three real readiness profiles are rerun before the full gate. The failed full-suite log and deterministic reproduction remain evidence; no test is removed or skipped.


## Published 2.2.46 qualification

All fixes were merged through focused PRs and released at `4269823977e95ca53d8581cd417322bf1c84129b`. The [release workflow](https://github.com/EyK-26/strata/actions/runs/39289540465) passed the complete quality gate: 2,452 unit/integration passes, the same two Linux platform-driver skips, zero failures, and all 123 E2E scenarios without failures/skips. The equivalent local gate had 2,451 passes and the same three macOS platform skips. No new skip or reduced coverage threshold was introduced.

Fresh disposable applications then used exact published `create-strata`, starter, core, bootstrap and CLI 2.2.46. All **88 scenarios passed, zero failed and zero were skipped**: 15 account journeys, 34 mounted React journeys, seven SPA-prefix scenarios including a generated Docker build, seven initial-admin reset profiles, 14 later-batch billing rollback profiles, three literal readiness profiles, two Adminer logins, two restricted-runtime MySQL migration profiles and four guest tenancy/write profiles. The [machine-readable report](qualification/starter-2.2.46-runtime.json) preserves each named outcome. This resolves the recorded starter defects within that scope; it does not turn the 2,688 structural combinations into 2,688 runtime-qualified applications.

The first published run also passed all 88 functional scenarios, but a post-run inventory found three anonymous Redis volumes. Changing the fixture's Redis healthcheck recreates the service, and Compose teardown can leave an earlier anonymous mount behind. An added ownership-based teardown assertion reproduced that leak on every readiness profile. The fixture now records mounted volume IDs from its own inspected Compose project, removes only known unused mounts after teardown, refuses to remove any mounted volume, and asserts no recorded mount remains. All existing readiness and unhealthy-service assertions are retained. This is fixture cleanup, not a framework/runtime workaround, and needs no additional package release.

The complete 88-scenario published matrix was rerun with those stronger cleanup assertions. Containers, volumes, networks, disposable databases and test MySQL users all returned exactly to their pre-run baselines. Both successful functional runs, the intermediate cleanup reproduction and the original 2.2.45 failures remain distinct evidence; the old reports were not replaced.

Per-scenario harnesses under `scripts/verify-starter-*.ts` accept `--published=2.2.46`; the corresponding native wrappers under `tests/e2e` define the selected profiles. With the documented host services and Chromium installed, representative reproductions are:

```sh
scripts/with-host-env.sh bun scripts/verify-starter-auth-journey.ts mysql-htmx-cookie-none --published=2.2.46
scripts/with-host-env.sh bun scripts/verify-starter-react-auth.ts --frontend=hybrid --auth=cookie-token-jwt --database=mysql --tenancy=column --dev --mfa --published=2.2.46
scripts/with-host-env.sh bun scripts/verify-starter-readiness.ts --database=mysql --published=2.2.46
```

These are local acceptance results, not capacity measurements, production deployment qualification or a promise of zero undiscovered defects. Shop adoption remains independently held on [Bun qualification #257](https://github.com/EyK-26/strata/issues/257).
