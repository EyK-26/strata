# Starter journey qualification

Generated output is a supported framework product. Booting a seeded demo and logging in does not qualify a new user's signup, mail, verification or reset journey. Every confirmed failure belongs in the generator or framework, with a regression against an external installed app.

## Confirmed defects in 2.2.42

Tracked in [#258](https://github.com/EyK-26/strata/issues/258):

- **MySQL auth timestamps.** The generated verification/reset token issuer binds an ISO `T…Z` string to DATETIME. MySQL rejects it with ER_TRUNCATED_WRONG_VALUE, errno 1292, SQLSTATE 22007. Public token consumption and session revocation bind the same incompatible format. Reproduced with strict MySQL and unchanged published packages; MFA alone was not the cause. Use the existing dialect timestamp API for database writes; wire-format timestamps remain ISO.
- **Concurrent signup.** Two fresh requests for one email returned 302/409 on MySQL despite neutral sequential duplicates. After the failed transaction/savepoint rolls back, the generated shared registration helper catches only a framework conflict with a confirmed existing account. It does not swallow unrelated persistence/observer errors. All profile journeys require neutral responses for both requests, exactly one account and one verification mail.
- **Partial signup.** The account commits before verification-token persistence. An injected immediate token observer failure leaves an account behind. Signup must commit the account and token together and send SMTP only after commit. An external SMTP failure after commit deliberately retains that account/token; browser owners can sign in and request a verification resend. Mail is synchronous here; this is not a durable mail outbox or an exactly-once delivery guarantee.
- **API documentation drift.** Cookie-only API apps were told to mint JWTs and call absent JSON reset/current-user routes; API docs also advertised a nonexistent root welcome page; JWT docs omitted JSON registration; token registration was falsely described as returning a token. Docs now follow the selected auth stack and preserve neutral registration. Six auth-stack generation regressions and actual API-profile route-inventory checks guard these claims.
- **Nested RLS commit boundary.** A controller savepoint can finish while the request transaction remains open. An SMTP outage regression caught this during the candidate fix. The framework `afterCommit` hook shares the existing deferred-event frames: successful savepoints promote callbacks to the outer commit; rollback discards them. SMTP failures after the real commit cannot undo the account.
- **Postgres no-tenancy seeding.** Generated seed initializes the default model pool only along the tenant-seed path. `migrate --seed` without tenancy can therefore query models without a registered pool. Initialize the connection before any seed model operation. Unchanged published Postgres/API/JWT/no-tenancy output reproduces the failure.

The first two registry reproductions were generated under an owned `~/perso/strata-security-*` directory and removed after investigation, including their owned databases. The existing `~/perso/test` app was left intact.

## Runtime matrix

`tests/helpers/starterJourneyProfiles.ts` registers fifteen named profiles: each database (SQLite, MySQL, Postgres) with each frontend (API, HTMX, React SPA, hybrid). Credential modes vary between cookie, opaque token, JWT, cookie+token, and cookie+token+JWT. Tenancy covers none, column and restricted-role Postgres RLS.

Each profile installs candidate package tarballs outside the repository. A registry mode instead invokes the exact published generator and pins and verifies the three exact published runtime versions (without local package substitutions); it never substitutes local runtime code. Every scenario runs in its own child process and owns its database, runtime/migration credentials and digest-pinned Mailpit container. SQL is limited to fixture provisioning; account/token assertions use the generated models and public framework APIs.

Assertions include actual HTTP CSRF rejection, signup and neutral sequential/concurrent duplicate signup, actual SMTP delivery, signed verification and signature tampering, token consumption/replay, login, SMTP password reset, old-credential rejection, replacement password login, failed token-persistence rollback and successful signup retry. Cookie profiles also exercise password-confirmed MFA enrollment, TOTP, single-use recovery codes, logout and SMTP outage followed by verification resend. Database state is checked independently of response status through the ORM.

This is a risk-based integration matrix, **not the full Cartesian product**. These journeys use array cache and sync queue. Existing generated runtime/OpenAPI, OIDC, SAML, Docker, Redis queue/cache and extras tests remain required complementary gates. SPA frontend names in this matrix do not alone prove browser JavaScript interactions or a built frontend. Redis/cache/queue combinations and browser assets must remain separately qualified. Header-auth profiles intentionally have no account-registration routes and are covered by generator/default-runtime tests.

## Run

Build candidate runtime packages, start the framework's test database services, then:

```sh
bun run build:framework
bun run build:bootstrap
scripts/with-host-env.sh env SKIP_FIXTURE_TEST_BOOTSTRAP=1 bun test tests/e2e/generatedAuthJourneys.test.ts
```

A single registry reproduction (creates and cleans up an owned app under `~/perso`):

```sh
STARTER_JOURNEY_PARENT="$HOME/perso" scripts/with-host-env.sh bun scripts/verify-starter-auth-journey.ts mysql-htmx-cookie-none --published=2.2.42
```

Docker is required; unavailable infrastructure fails the test rather than skipping it. No shared database is reset, no local app is patched, and owned Mailpit inboxes contain disposable credentials only. Logs do not print signed links, raw passwords or tokens. On forced process termination, inspect only owned `strata-signup-mail-*` containers and `generated_security_*` databases before removing leftovers.

## Independent blockers

The [API/SPA cookie lifecycle gap #260](https://github.com/EyK-26/strata/issues/260) reproduced valid-CSRF signup and forgot-password returning 404 despite successful JSON login in unchanged 2.2.42 output. The chosen contract is complete JSON account endpoints, without enabling HTML routes in API/SPA mode. Three additional installed profiles cover MySQL/API/no tenancy, SQLite/SPA/column tenancy and restricted Postgres/API/RLS. They retain the existing assertions and add JSON password confirmation, MFA setup/enrollment, missing/invalid/replayed proofs, stale epoch confirmation, credential revocation, owner-only verification resend after SMTP recovery, and verification gates. Generated type fixtures cover API and SPA cookie/security extras. A submitted malformed MFA secret additionally reproduced a 500; framework verification now rejects malformed/empty decoded secrets while trusted `generateTotp` keeps its strict encoding error contract. Exact-head full validation and published acceptance are required before calling the fix released.

Native Bun SQL timer qualification [#257](https://github.com/EyK-26/strata/issues/257) remains a separate expected-success gate. Passing these journeys cannot resolve or waive it. Shop adoption remains held under that gate. Deployed capacity, live-provider and independent security qualification are also separate from these local tests.

## Commit hooks and durable delivery

`afterCommit` from `@getstrata/core/database/transaction` registers process-local work against the managed outer transaction, including RLS request scopes. Await registration inside the transaction; the callback is awaited only after the successful outermost commit. Nested rollback drops its own callbacks; outer rollback drops all. With no active managed scope it runs immediately. Callbacks preserve tenant identity and execute in registration order with model events, but do not inherit a released database handle or bypass and do not open a transaction across external network I/O. Any RLS database work in a callback needs its own explicit database scope. A callback failure propagates after commit and stops subsequent delivery; it cannot roll back committed rows. Callbacks are not persisted and do not survive a process crash. Use the SQL outbox for durable effects, and do not depend on this hook to roll back a business operation when an external provider is unavailable.

## Investigation evidence

Unchanged 2.2.42 registry runs reproduced the MySQL signup failure and Postgres/API/JWT/no-tenancy seed failure. The first expanded candidate run passed six auth journeys but did not yet include SMTP outage. The later outage assertion exposed the nested RLS commit boundary and remained unchanged while the framework hook was added. A separate fixture defect (Docker choosing new ephemeral host ports after restart) was corrected by explicitly publishing owned reserved port numbers; it was not recorded as a framework defect. After these corrections all twelve journeys passed (zero failures/skips). Existing CLI/starter tests passed 251 cases, focused transaction/event/token tests passed 41 cases, and generated typechecks passed eight profiles on three compilers. Full exact-head release validation remains required before publishing; native #257 remains separately held.

## API/SPA cookie iteration evidence

The new MySQL/API cookie journey first failed with 404 where CSRF rejection was expected. After emitting the account routes, JSON cookie journeys passed signup, actual SMTP verification/reset and MFA/recovery. Malformed-secret coverage then reproduced a framework 500 (expected 422) and a native verifier test failed; the verifier fix passes the same assertions. The first complete rebuilt-starter type gate exposed an incorrect public middleware subpath and nullable directory emails, which were corrected. An earlier standalone typecheck had read stale `dist/cli.js`; the standalone verifier now rebuilds the generator before testing so that result cannot be mistaken for current-source acceptance. Full exact-head and registry results remain the release gates; no original assertions were removed.

The expanded no-store assertion also exposed the tenancy boundary converting HTTP errors to raw JSON without cache protection. This affected CSRF rejection in column/RLS profiles, while no-tenancy profiles used the standard error response. Two focused existing tenant tests now assert the missing header (18 pass/2 fail before the fix), and the shared boundary uses `privateJsonResponse`, preserving body/status and rollback behavior. The second full run retained 2,393 unit passes/three existing skips, but its 50 E2E cases had nine failures: four strict inventory assertions caught management routes accidentally added to HTML combined-auth apps, and five tenant-enabled JSON journeys caught the missing no-store header. Management routes were narrowed to API/SPA mode; the existing route baseline and all assertions remain unchanged. These failing results are investigation evidence, not release acceptance.

The third full run passed 2,393 unit/integration cases (the same three platform skips), coverage, all 50 E2E cases including fifteen journeys, and extras/SPA smoke. An additional explicit-JSON/HTMX password-confirmation regression then reproduced redirects for both guest and authenticated requests (zero pass/two fail). The confirmation middleware now honors the existing request metadata JSON contract before content negotiation; two native cases and an installed JSON MFA assertion cover it. A final complete run is required for this last correction before release.

Before merge, malformed JSON on a valid signed reset link additionally reproduced 500 instead of the framework parser's 400. The reset route now delegates to `parseJsonBody`. Every JSON journey submits malformed JSON and an invalid short password before successfully consuming the same proof, preserving the existing short-password403 contract and proving failed input does not consume the token. This extends existing bearer/JWT paths as well as the new cookie API.
