# Qualification status

Baseline: published Strata 2.2.35. This record separates implemented mechanisms from local acceptance and deployment qualification. Historical issue reports and failed runs remain evidence; an open tracker is not a statement that its entire original API is still missing.

## Runtime observability — #139

- Implemented: bounded opt-in Redis queue, SQL outbox/failed-job, transaction-acquisition and tracing-health collectors; authenticated metrics integration; generated lifecycle ownership. SQL collector adapters cover Postgres, file-backed SQLite and URL-backed MySQL. See [runtime metrics](RUNTIME-METRICS.md) for exact contracts.
- Local evidence: `tests/unit/queueMetrics.test.ts`, `metricsRoutes.test.ts`, `metricsRuntime.test.ts`, `outboxMetrics.test.ts`, `failedJobMetrics.test.ts`, `transactionAcquisitionMetrics.test.ts` and `tracing.test.ts`; `tests/integration/sqliteMetrics.integration.test.ts` and `mysqlMetrics.integration.test.ts`. The external shop separately exercises restricted-role SQL, concurrent scrapes, outage semantics, selected acquisition observations and Prometheus rule evaluation.
- Deliberate limits: capped counts are labelled/omitted as documented; stream residence age is not original job lifetime. Native acquisition observations are not all server-side pool waits. SDK queue occupancy and infrastructure persistence/capacity must not be invented. Shared-state gauges must not be summed across replicas.
- Still unqualified: sustained scrape cost under the selected workload, deployed aggregation/target discovery and actual notification delivery during dependency/collector outages. Some three-process and deadline behavior already has local coverage; extend only genuinely uncovered boundaries. Infrastructure exporters, workload thresholds and operator response evidence belong to the deployment qualification record.

## Encryption rotation — #140

- Implemented: identified retained-key reads, reader-first auth configuration, explicit bounded maintenance-mode field/lookup migration, durable checkpoints, compare-and-swap, fresh audits and rollback contracts. See [rotation](ENCRYPTION-ROTATION.md).
- Local evidence: `tests/integration/fieldEncryptionRotation.integration.test.ts` covers bounded resume/rollback, collisions, cancellation, restricted Postgres tenant scopes and three-process MySQL serialization. The external shop exercises real MFA storage, optional encrypted-email fixtures, its registered operator command and logical backup/restore with historical keys. Its production email policy remains plaintext; do not silently convert it to exercise encryption.
- Deliberate limits: `maintenanceMode: true` asserts operator fencing; it does not stop distributed writers. Online lookup-key rotation is unsupported and is not a new requirement. Live record audits do not authorize destroying keys still required by backups.
- Still unqualified: actual coordinated deployment fencing and reader/writer promotion, production/PITR restoration and independent security review of the complete procedure. Historical-key retention, recovery targets and approval are environment-specific requirements.

## Q01 packaged application matrix

The 18 generated compiler combinations are type checks, not 18 executable feature profiles. The preserved Postgres RLS security suite, native CLI/OpenAPI/HTTP cases and generated Docker acceptance execute installed candidate tarballs. Source-linked adapter/generator tests complement those gates but do not establish the same external-package boundary.

The additional Q01 profile exercises an external packed-package SQLite column-tenancy server-HTMX/cookie-token-JWT profile: explicit migration/seed, API-only OpenAPI and independent runtime inventory, real CLI admission, cookie/token/JWT requests, dependency readiness and clean shutdown. It also checks Basic admission, credential-specific logout and repeated SCIM list/create/delete/foreign-record denial with conflicting tenant headers. Missing optional dependencies or infrastructure fail required cases; no new skip is an acceptance strategy. The subsequent MySQL packaged HTTP/auth profile and additional OAuth/OIDC/SAML combinations are tracked below. Real external IdP/Stripe/SMTP/storage interoperability remains separate from owned local provider fixtures.

## Promotion sequence

1. Preserve current assertions and add executable coverage for an uncovered boundary. Reproduce mechanism failures before changing framework behavior; publish fixes before shop adoption.
2. Finish local #139/#140 gaps by evidence rather than reimplementing delivered APIs. Track operational qualifications explicitly while retaining their original reports.
3. Exercise deployed mixed-version/schema rollout, unsafe-rollout refusal, routing, failover and provider reconciliation under the recovery contract.
4. Approve the workload, environment, SLOs, recovery targets and budget; measure at least three HTTP replicas and two workers, then perform the 24-hour soak at the selected workload. No numerical capacity claim follows from local correctness tests.
5. Complete live provider, PITR/rotation and independent security qualification before promotion. These need the real test environment, provider credentials and reviewer; they do not prevent further local framework dogfooding.


## Q01 fixture validation history

The initial packaged SQLite CLI/OpenAPI/HTTP run passes before adding credential requests. The extended fixture first fails because its tenant setup imports a nonexistent default `BaseRepository` export; the published subpath uses a named export. Using the named import allowed the other HTTP expectations to run. Follow-up verification confirms that TypeScript actually accepts the default import advertised by published declarations while Bun rejects it. This is framework [#229](https://github.com/EyK-26/strata/issues/229), affecting nine core subpaths, rather than merely a fixture error. It requires an upstream packaging/export-verification fix; named-import acceptance does not resolve it. Test-client JSON is narrowed before property access; no cast-backed application contract is introduced. The corrected focused run passes all three runtime cases (the two original Postgres cases and the new SQLite case), with every previous route/OpenAPI/readiness/shutdown assertion retained. The final profile imports and uses the promised default constructor after #229, asserting it is identical to the named constructor. The unchanged 23-case security suite and frozen route/source inventories remain separate required gates. Full acceptance is recorded after the complete gate finishes; the packaged-default-export defect remains independently recorded until its upstream resolution.


The cumulative 2.2.36 candidate with the #229 fix passes full host acceptance: 2,353 source tests, zero failures and three unchanged engine/platform skips; all 27 native E2E cases pass without skips, including the new SQLite profile and preserved Postgres security/Docker cases. All 18 compiler combinations, installed default-export/model probes, package/export checks, integration extras and built SPA pass. Coverage remains 136 enforced files at 100% lines / 272 exemptions. Publication and deployment qualifications remain distinct gates. The final committed tree is rechecked by pre-push and clean Linux CI.


## MySQL packaged runtime follow-up — #232 / #233

The MySQL column-tenancy profile reproduces two mechanisms absent from earlier adapter/compiler coverage. #232: ordinary repository writes return a MySQL write header as the entity; the original four native regressions fail, including created-event payloads. The fix uses transaction-pinned persisted-row readback and preserves affected-row metadata for set operations. Six native cases cover defaults/keys/concurrent creates, mutation/soft-delete/restore outcomes, upsert/no-update behavior, events/rollback and explicit connection ownership.

#233: generated OpenAPI writes its file but retains the MySQL pool until the unchanged subprocess deadline kills it. OpenAPI factories now accept explicit application cleanup, finish it before failure exit, and preserve original/cleanup failures. Generated OpenAPI and failed-job wrappers own provider disposal and database closure. The profile executes generate, validate, successful/drifting checks, failed-job list/empty flush/missing retry and actual process exits. Unit tests retain existing output/exit assertions and add cleanup success/failure/bootstrap/error cases.

The mandatory MySQL profile preserves the 40-operation route inventory, 22 API operations, SDK methods and complete spec/SDK snapshots. Production APP_URL changes only independently asserted expected server origins and the SDK default origin. PostgreSQL/SQLite fixture snapshots remain byte-identical. Administrative setup/migration credentials do not reach the HTTP process; its owned runtime account must identify itself and fail DDL. It uses the starter's configured public virtual host over an owned loopback transport and asserts unknown-host refusal. This does not qualify deployed TLS. Production URL, token expiry, MFA encryption and SCIM fallback requirements are supplied rather than bypassed; the initial fixture configuration failures remain separate from the two mechanism reproductions.

The focused MySQL run passes real cookie/token/JWT/Basic, CSRF, credential-specific logout, disabled-provider gates, repeated SCIM cross-tenant CRUD/read denial with conflicting headers, dependency readiness, metrics concealment, web smoke and SIGTERM. Full host/pre-push/Linux CI gates remain required on the final committed tree. All previous assertions, compiler combinations, security/Docker/SQLite profiles and coverage thresholds remain. Additional provider combinations, live interoperability, deployed recovery/rotation, capacity/soak and independent review remain open.

The cumulative 2.2.37 host gate passes **2,365 source tests / 0 failures / 3 unchanged platform skips**, all **28 E2E cases / no skips**, all **18 compiler combinations**, package/type/export and integration-extra/built-SPA checks. Coverage remains **136 enforced files at 100% / 272 exemptions**. Final pre-push and clean Linux CI evidence belongs to the PR; publication/adoption follow merged-main and release gates.
