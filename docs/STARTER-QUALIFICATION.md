# Starter qualification evidence

`bun scripts/report-starter-pairwise.ts` is a planning inventory, not execution evidence.
`bun scripts/verify-starter-pairwise.ts --output=/absolute/path/receipt.json` executes
that same inventory outside the checkout. Generation imports the current starter source;
the generated consumers install immutable packed core, bootstrap and CLI candidates.
The harness does not invoke a packed starter CLI.
Build core and bootstrap in the current checkout first. Use `scripts/with-host-env.sh`
for the owned local PostgreSQL, MySQL and Redis fixtures; never provide cloud URLs.
`--compile-only` deliberately leaves migration and boot marked `not-run`.

The harness generates all 25 profiles, installs each distinct package requirement graph,
and runs each app's emitted `check` command with its installed TypeScript compiler.
Only generated package names are ignored when comparing install requirements; overrides,
optional/peer dependencies, scripts and all other manifest fields remain significant.
Each profile receives its own empty SQLite file or native database, with a restricted
native runtime identity. Admin credentials go only to migration, never HTTP. Two workers
run at most, each child has a 90-second bound, and owned database/user absence is checked
on cleanup. PostgreSQL uses the existing restricted fixture role; MySQL users are unique.

The boot probe starts the actual generated application on an ephemeral loopback port,
requests `/health`, checks the request ID and verifies successful application shutdown.
The receipt separates generation, dependency installation/reuse, typecheck, migration and
boot for each named profile, and records package hashes, inventory hash and limits.
This is backend compile/migration/boot qualification. It does not build the React frontend,
exercise Docker startup, send mail, contact an identity provider, deliver queue jobs,
or establish the behavior of an integration merely because its profile booted.
Fixture JWT and token-pepper secrets are supplied explicitly. Signing uses the generated
`SIGNED_URL_SECRET` or `SESSION_SECRET` from `.env.example`, without a harness override. Generated
`.env.example` values otherwise supply application config, with local database/Redis/mail
addresses and a unique cache namespace. This is not a literal onboarding test.

## Capability acceptance map

These are existing executable acceptance locations, not claims that every listed suite
was rerun with a particular receipt. Runtime receipts qualify the exact 25 inventory
profiles; these targeted suites prove deeper behavior in selected compositions.

| Retained capability | Existing executable acceptance | What the assertions establish / limit |
| --- | --- | --- |
| All frontend/database/auth/tenancy selectors; cache/queue/mail choices and extras | `scripts/verify-starter-pairwise.ts`; `tests/unit/cli/starterPairwiseProfiles.test.ts` | Exact inventory generation, installed backend types, first migration and real health boot; independent supported-pair accounting. No Cartesian guarantee. |
| ORM models, repositories, transactions and selected database sessions | `tests/e2e/starterCombinations.test.ts` (`orm`); `tests/fixtures/starter-combinations/orm.ts` | Installed generated consumer on SQLite/MySQL/PostgreSQL, actual persistence and transaction behavior. |
| Password login, CSRF, MFA, API tokens, JWT, SCIM, metrics and RLS | `tests/e2e/generatedApp.security.test.ts` | Generated HTTP flows, live restricted role inspection, cross-tenant SQL denial, session revocation, unsigned/wrong-audience SAML rejection. |
| Signup, SMTP verification, reset, replay and credential revocation | `tests/e2e/generatedAuthJourneys.test.ts`; `scripts/verify-starter-auth-journey.ts` | Owned SMTP fixture and real HTTP journeys. SMTP selection in a boot receipt alone does not prove delivery. |
| OIDC and SAML | `tests/e2e/generatedOidc.test.ts`; `tests/e2e/generatedSaml.test.ts`; `starterCombinations.test.ts` (`sso`) | Local HTTP IdP handshake, installed callback/session persistence and replay checks. No live enterprise IdP claim. |
| React/hybrid authentication and SPA prefix/static behavior | `tests/e2e/generatedReactAuth.test.ts`; `generatedSpaPrefix.test.ts`; `starterCombinations.test.ts` (`http`) | Built frontend auth transport and real HTTP policy/correlation/static fallback; pairwise backend boot does not replace these builds. |
| Guest tenancy | `tests/e2e/generatedGuestTenancy.test.ts` | Tenant policy with header identities and absent account tables across supported tenancy/database cases. |
| Queue webhooks and outbox | `starterCombinations.test.ts` (`webhook`); `generatedOutbox.test.ts`; `tests/integration/queue.integration.test.ts` | Local receiver delivery with sync/Redis queues; official PostgreSQL/RLS worker publish, drain/cancellation and lease recovery. No live external endpoint claim. |
| Billing migrations | `tests/e2e/generatedBillingRollback.test.ts` | Later-batch rollback preserves unrelated data across selected databases/tenancy/webhook settings. No outbound Stripe purchase proof. |
| Docker/dependency readiness | `tests/e2e/generatedReadiness.test.ts`; `generatedDocker.test.ts`; `generatedAdminer.test.ts` | Literal generated Compose readiness, first/repeated migration and unhealthy-service refusal; production RLS image startup/shutdown. Pairwise boot does not start Compose. |
| Module scaffold, factory, admin/reset and startup ownership | `generatedModule.test.ts`; `generatedFactory.test.ts`; `generatedAdminReset.test.ts`; `generatedStartupCleanup.test.ts` | Installed scaffold consumers, denied writes, reset security and owned startup-failure cleanup. |

Genuine remaining coverage limits include live GitHub OAuth and enterprise IdP configuration,
live Stripe billing, nonlocal SMTP/TLS provider compatibility, and external storage/S3 provider
behavior. These require distinct local contract fixtures or separately authorized provider
qualification; neither pairwise planning nor successful boot establishes them. The 25
profiles also do not prove all higher-order intersections or frontend builds for every profile.

## 2026-11-13 baseline

On source baseline `d904cbf`, the owned-isolation run generated, typechecked, migrated and
booted all **25/25** profiles using **four** distinct dependency installs. Evidence lives in
`evidence/integration-sprint2-2026-11-13/pairwise-owned-baseline.json` outside this worktree.
Core/bootstrap were freshly built in the qualification checkout before packing.

The first exploratory run incorrectly reused database migration histories between different
profiles; those migration failures were a harness error. Attempted rollback isolation also
correctly encountered the account-state administrative reset guard. Neither exploratory
receipt is qualifying runtime evidence. The final harness instead allocates a database per
profile. Exploration also found a generated JWT/email-verification signing-secret onboarding
gap; explicit local `SIGNED_URL_SECRET` is an acknowledged fixture override, with the
renderer correction tracked separately. That override was removed from the final harness
after the renderer emitted its dedicated signing secret; the historical baseline receipt
retains its explicit override declaration. Final integration requires a new receipt against
freshly built integrated candidates, not reuse of these baseline archives.
