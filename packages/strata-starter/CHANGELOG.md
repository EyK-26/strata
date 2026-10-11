# create-strata changelog

## 2.2.19

Fix explicit development fresh resets with unfinished outbox deliveries while preserving ordinary rollback guards. Record each completed reset down immediately so later refusal leaves recoverable migration progress; document partial-DDL/crash limits and old-history reconciliation. Add populated outbox, reset failure/migrate/retry and dialect regressions.

## 2.2.18

Add optional typed guardMigrationRollback for application-owned rollback history predicates; skip history reads only during explicit development fresh resets, propagate predicate failures, and reuse the contract for encryption-checkpoint archival protection. Document guard placement and unchanged reset/rollback safety; cover type, runner and real SQLite history regressions.

## 2.2.17

Add explicit development-only migration reset context while preserving guarded rollback and encryption archival; align generated fresh entries and reject production/staging or unsupported reset arguments before provisioning. Replace CSP-blocked error-page JavaScript navigation with safe same-origin links, and correct ambiguous Postgres/SQLite foreign-key messages without changing their HTTP status.

## 2.2.16

Allow managed outbox workers to reuse a configured instance, preserving application tenant resolution, listener registration and delivery settings. Keep generated listeners-only defaults compatible, reject ambiguous worker sources, and cover configured SQL delivery, cancellation, cleanup and TypeScript contracts.

## 2.2.15

- Batch legacy list-queue priority polling while retaining recovery and ownership contracts.
- Batch dialect-portable pivot writes with framework transaction/savepoint composition and consistent numeric/string ID toggle semantics. Noncanonical or textual IDs use sequential database comparisons to preserve coercion and collation behavior.
- New Redis scaffolds explicitly select Streams; existing unset transport settings continue to select lists.
- Generate the SQL outbox migration, listener registry and managed worker command. Durable publication and cache-invalidation activation remain explicit.

- Primary-key ascending `chunk` queries reuse the existing keyset walk, including default primary-key ordering; projections, joins, grouping, locks and other orders retain OFFSET behavior.
- Empty filtered pagination totals skip the row query. Nonempty page-number pagination preserves OFFSET semantics and its count-plus-row-query budget; explicit cursor/keyset APIs remain available for deep traversal.
- Independent hashed write casts run concurrently. Deterministic regressions prove concurrent start, complete awaiting and failure before model observers or SQL writes; hydration and existing-hash behavior are preserved.
- Streams workers poll retry promotion, pending recovery and new delivery across priorities in one bounded Redis script, preserving priority, ownership fencing and at-least-once delivery contracts.
- Clarify historical 2.1.0–2.2.13 release notes and database/queue documentation. Remove the consolidated 1.x-to-2.x migration guide; existing projects are upgraded individually.

## 2.2.14

Complete the scoped HTML rendering starter adoption: generated apps inject ViewRenderer through createViewProvider instead of copying renderPage; welcome pages opt into HTMX fragments with full-page fallbacks, auth retains existing contracts, and CORS preserves representation Vary headers. Includes generator, runtime auth and cache-header regressions.

Add optional typed resourceRoutes and strict mergeRouteMaps composition, preserving native Bun routing and app-owned middleware. Add explicit ViewRenderer.namespace prefixes with unchanged layout/Response/HTMX contracts; generated auth controllers use the namespace. Includes native HTTP, compile-time, rendering isolation and generator regressions.

## 2.2.13

- Add a typed per-app HTML renderer on top of the native response path.
- Add explicit HTMX page and fragment responses. A fragment can fall back to the full page. Layout and auth response contracts stay the same.

## 2.2.12

- Require Bun >=1.4.3; align CI, generated/existing example runtime pins and Docker stages to 1.4.3, with bun-types >=1.4.3 behind the official @types/bun shim.

Add identified field-encryption keyrings, reader-first email/MFA configuration, and explicit transactional maintenance rotation for ciphertext and lookup keys with durable checkpoints, RLS scopes, fresh retirement audits and backup/rollback guidance. Fix SQLite primary-key compilation for non-generated keys. Preserve legacy auth defaults; no automatic data migration.

## 2.2.11

Add independently interruptible read-only SQLite and MySQL observations; extend bounded failed-job and outbox metrics to file-backed SQLite and URL-backed MySQL with schema/index guards, real-engine regressions and three-process consistency tests. Preserve Postgres RLS and business transaction behavior.

## 2.2.10

- Add bounded OpenTelemetry SDK health observations and selected native transaction-acquisition histograms through explicit metrics options.
- Add bounded Postgres failed-job counts using ORM ID projections, with schema guards, native acquisition deadlines and read-only collector draining.
- Observe Streams retry promotion lateness using Redis time; cancellation cleanup sentinels omit unavailable age instead of reporting age since epoch.
- Generate typed runtimeMetrics opt-in and provider-owned SQL collector draining, including startup cleanup; HTTP-only defaults and borrowed tracing ownership remain intact.
- Keep additional SQL observation dialects, sustained operational qualification and encryption rotation explicit follow-up work.

## 2.2.9

- Pool checkout can be cancelled. `reserve({ signal })` on the native driver aborts while it is still waiting for a connection. Drivers without that method are not given a fake one.

## 2.2.8

- Add bounded, read-only Postgres outbox metrics.
- Add bounded, opt-in Redis queue metrics. List and Streams depth stay separate.

## 2.2.7

- `ORDER BY` accepts explicit `nulls: "first" | "last"`. Postgres and SQLite emit `NULLS FIRST` / `NULLS LAST`. MySQL has no `NULLS FIRST` / `NULLS LAST` clause, so it orders nulls with an `IS NULL` discriminator and leaves the rest of the sort unchanged.

## 2.2.6

- The CLI, when it supervises the app or worker as a child, forwards shutdown signals to that child and waits for it. The container launcher no longer exits while the child is still running.

## 2.2.5

- Container readiness no longer means the API is admitting traffic. Database readiness no longer provisions roles or creates a missing database. A failed configured admin connection does not fall back to a generated password.

## 2.2.4

- Composite keyset pages on Postgres seek with a row comparison (`(a, b) > (cursor)`), so the planner can start at the index bound instead of expanding the cursor into a chain of OR predicates.

## 2.2.3

- Add scoped composite keyset pagination. The order must end with the primary key. Global scopes and caller filters stay in force across the cursor. Joins, grouping, and offset queries are rejected.

## 2.2.2

- Schema `bigId` emits an explicit 64-bit generated identity.
- Repository writes can be conditional and set-based.
- Repositories and models can take a typed row lock inside the current transaction.
- Generated Postgres query handles keep tagged-SQL typing.

## 2.2.1

- Opt-in Redis Streams (`QUEUE_REDIS_TRANSPORT=streams`). Lists stay the default. Streams adds consumer-group recovery, persisted retry schedules, total job deadlines, opt-in cancellation, and a stable job id across replay. Conversion from lists is a stopped maintenance step.
- Failed jobs stay recorded until retry admission succeeds. Manual replay keeps `failed_job.job_id` when the row has one.
- Public reads and tenant host selection are separate. Unknown hosts fail closed. Forwarded hosts are accepted only from configured trusted proxies.
- Generated apps can provision one initial administrator with `auth:provision-admin` and a one-time claim migration. Demo seeding stays explicit and is rejected in production and staging.
- Quota and in-memory throttle docs match the code: memory throttles stay process-local, and a Redis failure does not fall back to them.

## 2.2.0

Consistent model scopes.
Changed-field model writes.
Awaited provider startup.
Shared cache correctness.
Native HTTP controls and body limits.
Graceful lifecycle.
Validated async discovery.
Stronger model input types.
OpenTelemetry tracing.
Distributed scheduler ownership.
App-owned quota policy.
Bounded memory throttling.

## Unreleased

- Document generated scheduler coordination defaults: Redis in production and explicit one-process operation for local deployments.

- Include the shared tracing provider in generated provider lists so HTTP, workers and schedulers flush telemetry before infrastructure closes.

- Await job discovery before queue construction and listener discovery before async registrar boot. Existing custom entrypoints must migrate to the new promise-returning discovery contracts; generated providers use the official shape.

- Generate one official awaited provider lifecycle, database readiness before HTTP, provider cleanup and queue/schedule resource ownership.

- Generate declarative model bases and awaited framework discovery instead of per-model repository construction and registration.

## 2.1.0

- Generated apps reuse the shared config store and base repositories instead of a copied stack.
- Password casts are awaited before the write reaches SQL or observers. Hydration does not hash.
- Model queries keep the concrete model type in their results. Service tokens, route handlers, and the starter's generated infrastructure were tightened in the same release.

## 2.0.9

- fix(starter): remove demo credentials from public login defaults

## 2.0.8

- fix(schema): preserve constraints and generate builder migrations

## 2.0.7

- Fix concurrent Postgres role provisioning across databases

## 2.0.6

- Dispatch registered Bun route preflights through CORS

## 2.0.5

- Allow explicitly approved application headers in CORS

## 2.0.4

- Place cache rollout guidance beside outbox docs without overlapping API additions

## 2.0.3

- Persist transactional events with leased tenant-aware SQL outbox workers

## 2.0.2

- Adopt TypeScript 7.0.2 in framework and generated apps; preserve tested TypeScript 5.9 and 6.x consumer compatibility.
- Verify six generated app configurations against three compiler versions and typecheck/build React SPA and hybrid frontends.
- Declare Bun-supported CSS imports in the SPA scaffold for TypeScript 7.

## 2.0.1

- Fix release lockfile drift and CLI 2.x peer compatibility

## 2.0.0

- Strata 2.0: compose business transactions and tenant scopes

## Unreleased

- 2.0: generated migration and reset entries do not seed automatically. Demo seed is an explicit development command, refuses production/staging before database access, and closes resources on completion or failure.

## 1.1.9

- Defer model events until the surrounding transaction commits

## 1.1.8

- Exclude HTML and SPA routes from generated OpenAPI specs

## 1.1.7

- Fix generated webhook SQL, billing hook, and hybrid SPA smoke

## Unreleased

- `--webhooks` inserts `webhook_deliveries` with the app dialect (`$1` on Postgres) and wraps that write in `runWithMigrationBypass()`. The job payload carries `event` instead of hardcoding `notes.created`.
- `--billing` calls `src/billing/applyStripeWebhook.ts` after a valid Stripe signature. The generated function is a no-op.
- Cookie SSO lowercases email. The OIDC login link stays hidden unless `FEATURE_OAUTH=true` and the client id and secret are set. Browser SSO failures stay JSON.

## 1.1.6

- Add optional OIDC cookie login and loopback discovery

## Unreleased

- Optional `--oidc` (cookie HTML, off by default) writes `GET /auth/oidc` and `/auth/oidc/callback`, a login link, and an `oidc_pkce` cookie. It calls `createAuthorization()`, not `getAuthorizationUrl()`.

## 1.1.5

- Close dogfood gaps: webhook docs, starter extras, signing helper

## Unreleased

- `.env.example` documents commented OAuth, billing, SIEM, and outbound webhook placeholders. Optional `--oauth-github`, `--billing`, and `--webhooks` emit GitHub cookie login, a Stripe webhook stub, or `webhook.dispatch` plus a `notes.created` listener. Off by default.
- Generated apps always write `src/models/register.ts` (side-effect model imports) so `with(["relation"])` aliases have a home.
- Generated README covers integrations, OpenAPI generate/check, and points at framework INTEGRATIONS.md.
- Cookie HTML `--oauth-github` adds `GET /auth/github` and `/auth/github/callback` (not OIDC cookie login).

## 1.1.4

- Publish http/uploads, validateUploadFile, migration-adoption docs

## 1.1.3

- Eager with() arrays, OpenAPI mkdir, public-read/auth docs

## 1.1.2

- Product CLI helpers, file migrations, and job discovery.

## Unreleased

- Generated apps ship `src/cli/register.ts` with `queue:work` through `@getstrata/cli/queueWorker` (`bootstrapApp({ migrate: false })` / `createApp()`, not `coreProviders`). Failed-job commands, `make:*`, `openapi:*`, and `schedule:run` are registered the same way. File-based migrations live in `src/db/migrations/` (`0001_starter_schema`) and run through `@getstrata/core/database/migrations`; `make:migration` writes into that directory. `src/bootstrap/schedule.ts` is generated for `schedule:run`.

## 1.1.1

Fix generated app boot

## 1.1.0

Breaking security hardening for generated apps, lockstep with `@getstrata/core` 1.1.0. Read the core 1.1.0 migration list.

CSRF on HTML and on mutating API routes, including guest JSON login (`POST /api/v1/auth/login`) and JWT mint (`POST /api/auth/token`). Fetch `GET /api/v1/auth/csrf` first. That response Set-Cookies the HttpOnly CSRF cookie and returns the same token in JSON. Send `X-CSRF-Token` (or form `_token`) plus the cookie. Nested API CSRF does not mint a second cookie. A missing token is JSON 403. CORS allowlists `X-CSRF-Token` and, when reflecting a specific origin, sets `Access-Control-Allow-Credentials`. The CSRF cookie is `SameSite=Lax`, so a different site cannot send it on fetch. Bearer and Basic skip CSRF only after that guard authenticates (`successful bearer or basic skips CSRF`). `failed Bearer header does not skip CSRF when credentialSource is null` is the Bearer header skip when `credentialSource` is null. `failed bearer does not fall back to a session or guest guard` is failed Bearer not resolving a session or guest user. HiroApp e2e `cookie login requires CSRF and ignores garbage Bearer` is garbage Bearer still requiring CSRF on POST `/login`. SCIM and SAML ACS skip CSRF by path. A missing or foreign `Origin` on a cookie mutating request is 403. `GET /login` and `GET /api/v1/auth/csrf` do not require Origin. The IdP-shaped ACS e2e is a test `fetch` to the app origin with `idpShapedHeaders()` Origin/Referer and HMAC RelayState, not a browser IdP POST.

SAML is HMAC RelayState without a Lax cookie. Replay defaults to SQL `auth_saml_assertions`. Tests may use in-memory. Both drop IDs after 1 hour. Signed responses and a required IdP issuer are the default. ACS compares assertion issuer to `SAML_IDP_ISSUER`. JIT uses `currentTenantId()` and is skipped when `FEATURE_REGISTRATION=false`. Generated SAML ACS still challenges MFA when `mfa_enabled` is true. Completing MFA enrollment revokes sessions and API tokens. There is no generated OIDC cookie login.

MFA is when enrolled, on HTML password POST, HTML MFA, API token mint, JWT mint, and Basic mint. Recovery hashes are persisted. `verifyCredentials` does not skip MFA. JwtGuard does not run TOTP on each request.

Password reset consumes one-time tokens atomically, compares aliased `sessions.created_at` to `session_valid_after` (not `users.created_at`), and deletes `sessions` plus `api_tokens`. JwtGuard rejects tokens issued before `session_valid_after`. Verify GET does not sign in.

`--tenancy=rls` FORCE RLS is on `notes` and `users`. `sessions`, `api_tokens`, and `auth_one_time_tokens` get a user-join policy plus an `app.bypass_identifier` pin on the real key columns. Auth lookups and those auth-table writes use `runWithMigrationBypassForIdentifier()`, which sets that GUC and does not rewrite SQL. Consume passes `hashOneTimeToken(token)`. SCIM scopes by `tenant_id` and throws if tenant ALS is missing. `createHealthRoutes` without `pingOnHealth` is always 200 JSON. Generated and HiroApp `/health` overwrite that with `schemaReady` (empty notes 200, unreadable not 200). Docker HEALTHCHECK fetches `/health`. Generated Compose still has a `postgres` superuser for volume init, GRANT, migrate, `migrate:fresh` DROP, and Adminer. Runtime `DATABASE_URL` uses `strata_app` (`NOSUPERUSER` `NOBYPASSRLS`), including `--no-docker`. Generated MySQL is still `mysql://root:…`. Production Compose runtime is `strata_app` after the split (`STRATA_APP_PASSWORD` required). This CI does not boot prod compose. `db/ensure-postgres-app-role.sql` is repeatable on an existing volume. Every rls runtime pool, including local, rejects username `postgres` or `root`, then inspects live `pg_roles`.

OIDC verifies RS256 ID tokens via discovery JWKS and a persisted PKCE handshake. App JWTs stay HS256. `at_hash` is verified when present; omitted `access_token` plus `at_hash` throws. GitHub OAuth uses `safeFetch`, always reads `/user/emails`, and rejects a missing verified address.

`GuestGuard`: production (`isProductionEnv`, including staging) is always null even when `AUTH_DEV_HEADERS=true`. Local `AUTH_DEV_HEADERS=true` still reads request headers.

Identity response headers are never set.

MFA is when enrolled. Enrollment is optional. Secrets are `enc:v1:` when a KMS key is set or in production. Local without a key may still return plaintext. Seed password is `StrataDemo!ChangeMe`. HTMX is the unpkg 2.0.4 pin. Generated login tokens mint `[]` abilities. Generated Compose Postgres password is `dev-postgres-change-me`. Generated Compose application role is `strata_app` / `dev-strata-app-change-me`. Generated Compose MySQL root password is `dev-mysql-change-me`. `127.0.0.1:54329` / `6379` / `33061` stay published. Adminer is debug-profile only.

## 1.0.9

Label HiroApp as internal e2e dogfood and seed notes via Model

## 1.0.8

- Container image starts and ships production dependencies only.

## 1.0.7

Always-custom wizard: frontend, one database engine, auth, tenancy, cache, queue, mail, extras, then optional Docker Compose per selected tool. In-repo example apps are generated from the same script.

## 1.0.6

- Generated apps depend on `@getstrata/*@^1.0.6`.

## 1.0.5

- Generated apps depend on `@getstrata/*@^1.0.5`.

## 1.0.4

- Generated header auth enables `x-authenticated-user-id` only when `AUTH_DEV_HEADERS` is exactly `true`.
- Generated `createApp` calls `isProductionEnv()` so `NODE_ENV=production` runs `assertProductionSecrets()` and skips auto-migrate.
- Generated apps depend on `@getstrata/*@^1.0.4`.

## 1.0.3

- Generated apps depend on `eta` themselves (welcome HTML). `mysql2` is added only for `--database mysql`. Core no longer ships either as a hard dependency.
- Generated apps depend on `@getstrata/*@^1.0.3`.
- Generated `docs/API.md` documents `GET /ready` again. 1.0.2 removed it on the premise that generated apps only serve `/health`; they spread `createHealthRoutes()`, so `/ready` is live. The row states what it checks (database ping, Redis ping only when `REDIS_URL` is set, no schema probe) and that `/health` remains the deploy gate. The boot test asserts `/ready` 200 JSON next to `/health` 503 on an unmigrated database.

## 1.0.2

- Generated `docs/API.md` lists `GET /health` only (plain text `ok`, or 503 `degraded` until the database ping and the `notes` table exist). It no longer claims a `GET /ready` JSON twin. Docker HEALTHCHECK already probes `/health`.

## 1.0.1

- Generated apps pass their own `bun run check`. Fixed `sql.unsafe<Array<T>>` double-wrapping (`unsafe<T>` already resolves to `T[]`) and the `AuthUserDirectory` import path.
- Accept a directory path as the project name. `bunx create-strata /tmp/my-app` used to fail validation.
- Generated apps ship a production `Dockerfile` (multi-stage, `oven/bun:1.4`, non-root, `HEALTHCHECK`, `APP_ENV=production`, `AUTH_DEV_HEADERS=false`, frontend built in-image for spa/hybrid, `VOLUME /app/storage` for SQLite) and a `.dockerignore`, plus a README "Deploy" section.
- `GET /health` answers 503 `degraded` until the database responds and the starter schema exists; `/ready` returns the same as JSON. A fresh deploy stays out of rotation until migrated.
- `SESSION_SECRET` has no generated fallback. Cookie apps read it through `sessionSecret()` in `src/bootstrap/config.ts` and refuse to boot without it.
- README production list adds `APP_URL`, `TRUST_FORWARDED_FOR` behind proxies, and the production CORS default. `.gitignore` covers SQLite WAL side files.
- Printed next steps use `bun run db:migrate` and `bun run dev`. `strata` installs into the app, not onto `PATH`.
- MySQL apps migrate and boot. Bounded the keyed and defaulted string columns MySQL cannot index or default, added the missing `CREATE DATABASE`, and formatted timestamps for `DATETIME`.
- `ensureAppDatabase()` keeps the database name from `DATABASE_URL` instead of forcing a `<project>_test` rename.
- Inapplicable extras passed as flags now warn and stay off, matching the wizard. `--auth headers --mfa` no longer writes `FEATURE_MFA=true` into an app with no MFA code.
- `spa-react` and `hybrid` apps ship the `frontend:install` and `frontend:build` scripts the 503 page names, and the SPA calls only endpoints the generated backend serves.
- `docs/API.md` is generated per layer, so it lists only routes the app actually has.
- `strata start` does not migrate when `APP_ENV=production`.

## 1.0.0

- First stable release. Interactive lists take arrow keys from the terminal fds under `bunx`. Postgres and MySQL Compose stacks include Adminer. Generated apps depend on `@getstrata/*@1.0.0`.

## 0.1.13

- Interactive lists take ↑/↓ from the terminal fds, including `bunx`, instead of opening readline first (that path printed `Choose [1]:` with no arrows).

## 0.1.12

- Postgres and MySQL Compose stacks include Adminer (http://localhost:8080) unless you pass a `--docker-services` list without `adminer`. SQLite and `--no-docker` do not get it. Mix mode asks after the database container.

## 0.1.11

- Interactive lists use ↑/↓ and Enter. Number keys still pick an option.
- Extras (MFA, email verification, SCIM, metrics) are a toggle list: move with arrows, Space or 1-9 to enable one by one, Enter to continue.
- The extras list is filtered by earlier answers: header auth only offers metrics; MFA needs cookie HTML; SCIM and email verification need a users table. Flags such as `--no-metrics` remove that extra from the list.
- Metrics `GET /metrics` is generated only when the metrics extra is on.
- Yes/no prompts use ↑/↓ (or y / n) instead of only typing.

## 0.1.10

- Cookie / cookie-* apps get a restyleable HTML auth kit: welcome, login, register, forgot/reset password (`views/` + `public/assets/site.css`).
- Token and JWT apps get JSON register and password reset.
- `--tenancy=column` writes a tenant table on any engine. sqlite/mysql `--tenancy=rls` becomes `column` instead of `none`.
- Selected extras emit MFA pages, email verification, and a SCIM `/Users` adapter (not env flags alone).
- `strata migrate` seeds empty tables (demo login after migrate).
- Seed and email-verify timestamps bind as ISO strings so SQLite parameter binding succeeds.
