# Compatible quality batch — published 2.2.51

[Release 2.2.51](https://github.com/EyK-26/strata/releases/tag/v2.2.51) is published
from `8db17add9dc33bf593f29a2b598553bed6efe78a`. Its tree equals the locally
validated release candidate.
The official coordinated five-package bump, actual-main CI/security, release
readiness with npm checks and fresh unused-version/tag guards passed. The complete
trusted workflow succeeded, including npm, container and GitHub release jobs;
all five exact versions and package integrities were independently verified.
No direct secret-based publication, force push or hook bypass was used.

## Confirmed defects and regression corrections

- [#331](https://github.com/EyK-26/strata/pull/331) decodes static request URL paths
  once while retaining generic filesystem semantics, literal percent/space names,
  guarded hooks/HEAD and private/traversal rejection.
- [#332](https://github.com/EyK-26/strata/pull/332) fixes explicit nested polymorphic
  traversal, concrete owner selection and cached flat-to-nested loading. A shared
  relation-method resolver removes duplicated dispatch responsibility.
- [#335](https://github.com/EyK-26/strata/pull/335) corrects an extra observer callback
  getter read introduced by #332 before publication. The same control passes on
  published 2.2.50 and failed on the unreleased candidate. Existing observer
  invalidation/materialization behavior is retained. All observed models use the
  conservative reload path; callback evaluation belongs to established dispatch.
- [#336](https://github.com/EyK-26/strata/pull/336) prepares the official coordinated
  patch release and package-specific notes. Existing customized generated app
  sources are not rewritten by a dependency update.

Original red reproductions, failed intermediate observer controls and fixture
preparation logs remain separate from green acceptance. The first published attempt
stopped after 130 profiles: 129 passed and one strict receipt-version check failed;
the four added profiles had not executed. A copied tenant fixture still labeled its
receipt 2.2.50 although actual installed packages were 2.2.51 and all four behavioral
cases had passed. The corrected receipt derives the actual installed core version;
every behavioral declaration/assertion and the strict outer version check remain.
That incomplete attempt is retained, not added to the final acceptance count.

While CI ran, global Bun had changed to 1.4.4 before that attempt. The successful
full rerun uses an isolated official Bun 1.4.3 binary matching the repository/release
pin, with binary/package integrity and parent/child/bunx checks. Global Bun was not
downgraded or modified. Historical declared test commands, all arguments and timeouts
remain; the runner explicitly selects the pinned native executable and records that
distinction. This is test toolchain isolation, not an application runtime workaround.
All 134 were executed again; the earlier 129 passes are not added to the acceptance
count.

After the successful publication workflow, registry propagation briefly left one exact starter manifest
unavailable; all five became available before any qualification profile executed,
without a publication retry.

Initial native SQL fixture errors were corrected using native adapter delegation and the existing generated
migration privilege owner, without new grants or business SQL. A focused command
initially omitted the required host environment and failed before tests executed;
its unchanged tests passed after correcting the invocation. A new external wrapper
needed a locally inferred piped SDK child for stream typing; no runtime assertion
was relaxed. No package patch, application mechanism workaround or extra skip was
introduced. M0 compatibility inventory is evidence, not a claim that old code was
bug free.

## Tested compatibility and actual acceptance

All **134 registered exact-published profiles executed and passed**, zero failed
or skipped. All established 130 commands, names, timeouts and consumer assertions
remain intact. Four appended profiles run thirteen static URL controls and all
sixteen nested ownership controls on each native SQLite/MySQL/PostgreSQL engine.
These retain flat eager record and lazy Model shapes, constructor/private ownership,
visibility scopes, cached traversal, query counts and observer behavior.

The separate compatible rehearsal passes **12 profiles** across three SQL engines
and API/HTMX/SPA/hybrid frontends, using cookie auth without tenancy. Each executes
exact 2.2.50, upgrades to exact 2.2.51, then restores original dependency manifests
and locks and executes exact 2.2.50 after native frozen installation. Source/build
hashes, app customization, durable rows and rows written after upgrade survive.
This is not actual-major, custom-auth-policy, cached-browser or deployment proof.

The release candidate's normal pre-push gate passed **2,682 unit/integration
tests** with zero failures and three existing skips: two MySQL/RLS exclusions and
the Linux reusePort test excluded on macOS. All **167 E2E tests** passed with zero
failures/skips. The focused release-tool suite passed 73 tests. Coverage stays 151 enforced/272 exempt; package/export/type,
generator, API-only OpenAPI, extras and SPA checks pass. Every earlier focused PR
also completed its required full local gate. Actual Linux main CI passes 2,683
unit/integration tests with the two existing unsupported MySQL/RLS exclusions and
all 167 E2E; Linux also executes reusePort. Dependency audit reports no vulnerabilities
across 91 packages. The human authorized PR merge without waiting for CI; actual
cumulative main CI/security still passed before tagging.

Fresh captured SQL/Docker metadata matches baseline in every field except capture
time. The [sanitized evidence](qualification/quality-batch-2.2.51.json) records actual
counts, canonical metadata hash, registry integrity, all profile-log hashes,
upgrade/rollback evidence and each PR's validated head/merge/tree. Read-only checks
find the exactly receipted Redis namespaces and marker absent. Only the receipted
UUID scratch/cache root is removed, without following symlinks or pruning unknown
resources. Original framework/shop checkouts and the two user Bun files remain
preserved. Cached engine images are not part of the captured container/volume/
network equality claim and are not globally pruned. The isolated pinned CLI and
its provenance are retained for reproducibility; it does not replace global Bun.

## Native assets: bounded feasibility, remaining major-version design

[#333](https://github.com/EyK-26/strata/pull/333) qualifies one pinned native Nginx
configuration: a protocol group, four strict 64 MiB graceful-delivery controls and
seven encoded filename controls. [#334](https://github.com/EyK-26/strata/pull/334)
retains seven browser controls and adds three native import-map integrity controls.
Correct metadata blocks a changed dynamic chunk in pinned Chromium; omitted chunk
metadata permits its execution. Asset requests lack fixture credentials and the
relative app API retains its cookie. These **five engine and ten browser cases are
separately counted**, not added to the 134 framework profile count.

See [static-engine evidence](PUBLIC-ARTIFACT-STATIC-ENGINE.md) and
[module-integrity evidence](PUBLIC-ARTIFACT-MODULE-INTEGRITY.md). They do not fix
native Bun asynchronous-pipeline truncation or mixed HTTP/WebSocket abort reporting.
Original strict byte/hash failure receipts are unchanged. Native Bun HTML still
does not automatically emit required integrity metadata.

The selected major-version direction remains an **explicit public artifact
origin**, with guarded app-origin documents/private files. Exact manifest/resolver/
view APIs, source/document ownership, path policy, first provider, TLS/cookie/CSP/
CORS policy, complete module/asset inventory, supported browsers, workers/CSS/fonts/
images, retained builds and cached-client rollback still require concrete acceptance.
Serving a filename successfully does not silently relax the proposed manifest rules.
No breaking API, public origin deployment or unsupported loader workaround ships.
Finite guarded-route typing, actual API/web capability contracts and canonical
route/collision/method diagnostics also need concrete major design, negative
compile fixtures and real HTTP migration proof. Existing 2.x aliases and
current route precedence remain intact until that reviewed change.

M2/M3 retain current runtime/DI and protected ORM extension contracts; unknown
external/dynamic consumers are not presumed absent. M4 needs per-app major
migration/source/config/lock/data maps, deprecation/support windows and exact
rollback artifacts. M5 persisted keys, envelopes, leases, fences, audit formats and
SDK/driver boundaries are unchanged; versioned protocol migration follows only a
concrete accepted change. M6's opt-in next channel remains a proposal: no major
version, prerelease activation, support deadline or immutable-version overwrite.

Shop adoption remains **manually held for #257** although the issue is closed/
completed. Neither its closure nor this batch lifts that hold or newly qualifies
native SQL retirement timers. No shop package/source/deployment changed. The
recurring timer remains **off**.
