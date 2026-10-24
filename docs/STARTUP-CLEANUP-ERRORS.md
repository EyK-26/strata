# Generated startup cleanup error retention

Published 2.2.54's generated `src/bootstrap/server.ts` can hide an original native
bind failure when context/provider cleanup also rejects. The real generated-entrypoint
regression fails on the missing original cause before the correction and passes
afterward. Published 2.2.55 retains that original error as `AggregateError.cause`
and includes every cleanup failure, attempting context disposal and database close
in the existing order. If cleanup succeeds, it rethrows the original error unchanged.

This is an error-retention correction. It does not force-close failed drains,
shorten leases, add startup retries or implement a new diagnostic/route/asset API.
The existing leave-infrastructure-open assertion remains unchanged. The historical
rendering manifests and test bodies remain unchanged; the exact reviewed delta gate
checks both corrected bytes and the historical reverse/forward roundtrip.

## Qualified publication and bounded controls

All five packages publish as 2.2.55 through the full successful trusted release,
after actual merged-main CI/security and official actual-main npm readiness checks.
All 159 preserved published profiles and twelve 54→55→54 exact-lock rollback profiles
execute with zero failures/skips. The separate sixteen published startup controls
include twelve corrected startup retries, two ordinary/late-request restarts and two
intentional failed-drain no-retry cases. Fixture-owned final recovery remains separate
from automatic framework cleanup. All captured qualification SQL/Docker metadata and
owned Redis/filesystem resources return to their fresh baselines. Unowned resources
remain untouched; concurrent global observations are reported honestly.

The [sanitized receipt](qualification/startup-cleanup-2.2.55.json) records identities,
actual local/main gates, all profile/input/log hashes, publication, cleanup and limits.
Earlier source/published54 failures and the dated M1 startup receipt remain unchanged.

## Existing customized applications

Dependency upgrades must preserve application-owned generated source. They therefore
do not install this template correction into an existing application's server file.
Adopt only the reviewed cleanup catch change from a fresh published 2.2.55 template,
retaining surrounding custom bootstrap, server options and lifecycle registrations.
Validate the application's actual bind/cleanup failure path and normal startup.

A separate fresh customized SQLite/header app demonstrates the boundary: original54
source reproduces the masking defect; deliberately adopted55 source retains the native
cause with54 dependencies, after upgrading55 and after exact package/lock rollback54.
A custom source marker survives every phase. Deliberately restoring the original54
source restores the known defect. This is one bounded app rehearsal, not a promise
that arbitrary application changes or future major migrations are compatible.

Record source/config/build and dependency/lock snapshots separately. A dependency
rollback must not silently erase an adopted source correction or overwrite other
customizations. Review any source reversal explicitly; restoring the previous code
also restores its known defects. These checks do not qualify major asset/router
migration, cached-client compatibility or production adoption.

## Remaining design gates

The [M1 proposal](M1-STARTUP-VALIDATION-PROPOSAL.md) distinguishes original failure,
cleanup outcome, resource ownership and caller-controlled retry. Exact API/grammar/
method/owner/diagnostic acceptance, M2-compatible candidate publication, live admitted
work/database-close/worker failures, provider/browser/full-graph security and major
migration/deprecation/rollback remain open. Native pipeline truncation and mixed
HTTP/WebSocket completion ambiguity remain unresolved. Breaking implementation stays
paused; shop adoption stays manually held for #257 and the timer stays off.
