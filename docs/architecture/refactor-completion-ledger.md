# Breaking refactor completion ledger

This is the acceptance and deletion map for the approved breaking refactor. It
supersedes intermediate completion claims, not historical failure receipts. The
2026-11-13 audit started at `ae3ce18`. A test location below identifies executable
acceptance; it does not claim a successful execution on the final release revision.
The integration owner records two complete required-gate executions, exact source
and package hashes, skips, independent challenge and exact-head CI separately.

## Required architecture acceptance

| Approved contract | Executable acceptance locations | Acceptance boundary |
| --- | --- | --- |
| Application owner, partial boot, concurrent transitions, late acquisition and cleanup | `tests/unit/applicationOwnership.test.ts`, `applicationTransitions.test.ts`, `applicationLateOutcomes.test.ts`; `tests/e2e/applicationOwnership.test.ts` | Interleaved owners and failed/late startup; packed owner identity. Health boot alone cannot establish cleanup. |
| Typed services, lifetime and expired execution boundaries | `tests/unit/applicationServices.test.ts`, `applicationOwnedExecution.test.ts`, `applicationExecutionResources.test.ts`, `establishedScopeIsolation.test.ts`; `tests/e2e/applicationServices.test.ts` | Explicit owner/execution identity, scoped resource lifetime and packed contracts. |
| Immutable application configuration and isolated adapter owners | `tests/integration/coreProviderConfiguration.integration.test.ts`, `applicationCacheOwnership.integration.test.ts`; `tests/unit/queueProviderSnapshot.test.ts`, `httpPolicyIsolation.test.ts`, `viewOwnership.test.ts`, `tracing.test.ts` | Provider snapshots and independently disposed owners. HTTP, view, crypto and credential helpers must also use explicit captured configuration; provider tests alone do not establish this. |
| Authentication provenance, no downgrade, awaited fail-closed policies | `tests/unit/authOutcomes.test.ts`, `authCapabilities.test.ts`, `authGuestSource.test.ts`, `policyAwaited.test.ts`, `boundPersistenceHttp.test.ts`; `tests/e2e/generatedApp.security.test.ts` | Absent/invalid/error distinction, explicit principal, deny/error and credential revocation. Rejected session cookies expire on 401 without same-request guest admission; forged bearer credentials cannot clear a valid session. |
| Owner-bound persistence, no default database or structural rebinding | `tests/e2e/databaseSessions.test.ts`, `boundPersistence.test.ts`, `repositoryRebinding.test.ts`, `modelRegistryContracts.test.ts`; `tests/unit/database/selectedNamedConnections.test.ts` | Application/session-bound repository and model behavior; missing/expired owner rejects. |
| Real transactions, savepoints, rollback, deferred effects and RLS | `tests/unit/transactionComposition.test.ts`, `transactionRollback.test.ts`; `tests/integration/mysqlTransactions.integration.test.ts`, `transactionRls.integration.test.ts`, `postCommitHttp.integration.test.ts`, `sqlOutbox.integration.test.ts` | Durable commit differs from post-commit observer failure; native driver/RLS behavior requires native fixtures. |
| One executable route inventory, middleware exactly once | `tests/e2e/routeCollisionContracts.test.ts`, `nativeRouteContracts.test.ts`, `generatedRuntime.test.ts`; `tests/unit/httpHandlerBoundary.test.ts` | Immutable metadata, executable dispatch and accurate OpenAPI/SDK contracts. |
| One validated starter plan, no partial output | `tests/unit/cli/starterWorkTracker.test.ts`, `starterPairwiseProfiles.test.ts`; `scripts/verify-starter-pairwise.ts` | Unsupported inputs reject before output; installed backend types, migration and health boot for each planned profile. |
| Reference commercial workflows from installed candidates | `tests/unit/cli/starterWorkTrackerInstalled.test.ts`; `tests/fixtures/work-tracker/acceptance.ts.txt` | PostgreSQL/RLS cookie/server and SQLite column/token/API: two tenants, owner/member/viewer, CSRF denial, rollback, revocation, durable worker delivery and idempotent retry. |
| Distribution, positive/negative public imports and dependency direction | `scripts/verify-export-types.ts`, `verify-core-cold-imports.ts`, `verify-core-shared-subpaths.ts`, `check-module-imports.ts`, `check-application-boundary.ts`; packed E2E consumers | Fresh archives, shared token identity, retired/private imports rejected, no source aliases in installed consumers. |

## Retained capability acceptance

The starter inventory has 21 dimensions and 25 compiler-valid profiles covering
1,168 feasible pairs. Its backend boot receipt is only one part of M6. The
following checks supply behavioral acceptance beyond `/health`.

| Capability family | Executable acceptance | Scope / remaining external qualification |
| --- | --- | --- |
| SQLite, MySQL, PostgreSQL; no/column/RLS tenancy | `tests/e2e/starterCombinations.test.ts` (`orm`), `generatedGuestTenancy.test.ts`, `generatedApp.security.test.ts`; native transaction/RLS integration above | Real drivers, tenant denial and transaction behavior; unsupported RLS combinations reject in the feature compiler. |
| API, server/HTMX, React and hybrid | `tests/e2e/generatedReactAuth.test.ts`, `generatedSpaPrefix.test.ts`; `starterCombinations.test.ts` (`http`) | Built frontend credential transport, prefix and static fallback. Pairwise backend boots do not build every frontend. |
| Cookie, token, JWT, combined, basic and development-header credentials | `tests/e2e/generatedApp.security.test.ts`, `generatedGuestTenancy.test.ts`; `tests/integration/basicRequestAuth.integration.test.ts`; `tests/unit/authOutcomes.test.ts`, `bootstrapAuthContext.test.ts` | Invalid credential precedence, account status and revocation; development credentials must reject in production. |
| MFA, verified email, password reset and session/CSRF | `tests/e2e/generatedAuthJourneys.test.ts`; `tests/unit/cli/starterMfaEnrollment.test.ts`; `tests/integration/mfaRecovery.integration.test.ts` | Real HTTP and owned SMTP, replay/revocation and CSRF negatives. |
| GitHub OAuth, OIDC and SAML | `tests/unit/oauthProviders.test.ts`, `oidcIdToken.test.ts`, `oidcProvider.test.ts`, `samlAssertionReplay.test.ts`; `tests/e2e/generatedOidc.test.ts`, `generatedSaml.test.ts` | Local provider contracts and real local IdP handshakes; no live GitHub/enterprise IdP claim. OIDC caches and outbound policy belong to each client/provider. |
| SCIM and metrics | `tests/e2e/generatedApp.security.test.ts`; `tests/unit/scimAuthMiddleware.test.ts`, `scimThrottleMiddleware.test.ts`, `scimTenantTokens.test.ts` | Credential, tenant and authorization negatives; selector presence alone is insufficient. |
| Array/Redis cache and invalidation | `tests/e2e/applicationCache.test.ts`; `tests/integration/redisCache.integration.test.ts`, `redisCacheCoordination.integration.test.ts`, `durableCacheRls.integration.test.ts` | Tenant key separation, owner isolation, coordination and durable invalidation. |
| Sync/Redis queues, worker/CLI, retry and failed jobs | `tests/integration/queue.integration.test.ts`, `queueReservations.integration.test.ts`, `queueConnectionRecovery.integration.test.ts`, `failedJobRetry.integration.test.ts`; `tests/unit/queueAttemptContext.test.ts`, `queueHandoff.test.ts`, `cli/queueCommands.test.ts`; `tests/integration/queueIdentity.integration.test.ts` | Native reservation/recovery and retry; authenticated actor/tenant handoff binds application audience, job name and payload before a fresh owned execution. Unsigned custom jobs deny when a verifier is configured. |
| Durable outbox and webhook delivery | `tests/e2e/generatedOutbox.test.ts`; `starterCombinations.test.ts` (`webhook`); `tests/integration/freshOutboxRecovery.integration.test.ts`, `sqlOutbox.integration.test.ts` | Transactional records, local receiver, cancellation, lease recovery and idempotency; at-least-once external effects. |
| Log/SMTP mail and custom drivers | `tests/unit/mailer.test.ts`; `tests/e2e/mailDriverExtension.test.ts`, `generatedAuthJourneys.test.ts`; `tests/integration/smtpTransport.integration.test.ts`, `mailDriverContract.integration.test.ts` | Real local SMTP protocol, TLS/cancellation and app transport isolation; external provider compatibility remains separate. |
| Local/S3 storage | `tests/unit/storage.test.ts` | Real local filesystem and Bun S3 client against a local protocol fixture (missing key/bucket/auth distinctions), plus delegation contracts. No live S3 compatibility claim. |
| Billing | `tests/unit/stripeWebhook.test.ts`; `tests/e2e/generatedBillingRollback.test.ts` | Signature/timestamp rejection and migration rollback preserving unrelated data. No live Stripe purchase proof. |
| Encryption, MFA secrets and key rotation | `tests/unit/fieldEncryption.test.ts`, `fieldEncryptionKeyring.test.ts`, `fieldEncryptionAuth.test.ts`, `mfaSecret.test.ts`; `tests/integration/fieldEncryptionRotation.integration.test.ts` | Crypto and key rotation contracts, including owner-captured encryption/MFA codecs rather than ambient per-operation keys. |
| Scheduler, tracing and deployment extras | `tests/integration/schedulerLeases.integration.test.ts`; `tests/unit/tracing.test.ts`; `tests/e2e/generatedReadiness.test.ts`, `generatedDocker.test.ts`, `generatedAdminer.test.ts` | Leases, provider ownership and literal local Compose behavior; no hosted deployment qualification. |

## Retired assertions and replacement behavior

The persistence and application retirement documents retain the detailed ledger
for default/bound/named database registries, process-wide application facades and
string service identities. Their global mutation/identity snapshots are retired;
owner isolation, transactions, cleanup and packed absence remain required.

Additional removed tests are accounted for explicitly:

- `tests/unit/transaction.test.ts` selected the implicit bound client, adapted raw
  transactions and rejected missing `begin()`. Implicit selection is retired;
  selected-session transaction composition, native driver capability rejection and
  raw transaction behavior remain in `transactionComposition.test.ts`,
  `transactionRollback.test.ts`, `legacyNativeTransaction.test.ts` and native driver
  suites. The old API must not be restored merely to preserve its setup.
- `tests/unit/transactionScopeBoundaries.test.ts` asserted the retired rollback-frame
  helpers. Caught nested failure and savepoint-local rollback now have behavioral
  replacements in `transactionComposition.test.ts` and `transactionRollback.test.ts`.
- Scaffold delta/hash fixtures and their two artifact-delta helpers were historical
  template comparisons. Generated installed security/auth and combination workflows
  remain the behavioral contract; deleting those fixtures does not waive those flows.
- The `abilityCatalog` test that mutated the process-wide catalog is retired with
  `configureAbilityCatalog`/`abilityCatalog`. Default role constants/resolution remain;
  application-specific authorization is supplied through explicit policy/ability ports.
- OIDC tests no longer reset process-wide discovery/JWKS caches. Each owned client
  has private caches; separate providers cannot inherit another owner's permissive
  network policy or cached discovery. An old test mutating a shared discovery object
  was replaced by an assertion that provider caches are isolated.

## Acceptance status

This ledger is a review map, not a release certificate. Final integration must
resolve all assigned view, queue, HTTP/security configuration and crypto ownership
cuts, reconcile current documentation, and run the complete required gates twice
on one frozen revision. Historical 2.x qualification and the earlier 25-profile
receipt cannot qualify changed source or newly built package archives.
