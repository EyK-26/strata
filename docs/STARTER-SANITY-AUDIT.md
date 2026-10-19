# Starter sanity audit — published 2.2.45

Audit date: 2026-10-19. Framework source: merged `5d6d5b62e364628a98c8aa3c7cfe04585f3a74ee`. Runtime reproductions used exact `create-strata@2.2.45` from npm and explicitly verified installed core/bootstrap/CLI 2.2.45 in disposable applications under `~/perso`. The existing user application and the shop were not edited. This is a versioned baseline, not a claim that all supported applications are qualified.

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

## Candidate SPA-prefix regression coverage

The focused #264 fix adds a shared validated namespace and exercises both React frontends at `/app`, `/workspace` and `/team/portal`. Each scenario runs the literal generated install/build/dev/preview scripts, fetches real JS/CSS with content-type checks, checks nested history requests and API isolation, and checks that private configuration is absent from bundles. A separate nested-prefix scenario builds the generated Docker frontend stage. Candidate-only archives are copied into its build context; published acceptance uses the unmodified Dockerfile and npm dependencies.

These are document/asset/server assertions, not a claim of mounted React navigation coverage. The separate #263 browser journey work supplies that missing boundary. Original 2.2.45 failures above remain the published baseline until the cumulative release is qualified.


## Candidate separate-credential MySQL acceptance

Additional limited-runtime browser qualification exposed [#276](https://github.com/EyK-26/strata/issues/276). Both generated provisioning and the MySQL migration wrapper used runtime credentials despite a supplied administrative migration URL. The fix selects the explicit administrative credential for schema work, scopes it through the published connection API and closes it after success/failure; runtime privileges and production/staging no-provision defaults remain unchanged.

New native cases execute real generated MySQL none/column apps with distinct schema and runtime credentials. They cover migrate, status, credential-state rollback refusal, a reversible later migration batch, fresh/reapply/seed, actual ORM reads, denied runtime DDL, and connection restoration after a failing migration callback. Status and rollback use the existing generated entrypoints; no new public CLI command is assumed. Original limited-role failures are retained before the passing candidate run.
