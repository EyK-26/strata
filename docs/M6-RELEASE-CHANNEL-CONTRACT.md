# M6 implementation contract: isolated prerelease tooling

Status: P1–P6 approved for local implementation and full validation on 26 October
2026. A focused review PR is separately authorized. No actual version, tag,
merge, publication or deployment is authorized. The compatible
publish-decision correction remains independently reviewable from new channels.
Shop adoption remains held for #257; the timer remains off.

## 1. Baseline and scope

Reviewed stable main `a87baf07126b14b6d1ce3898c6b59e9eb512ce35`, version 2.2.59.
The eight release-source owners listed in `baseline-source.json` are byte-identical
at M1 PR #377 head `b3671f27024deeca40e6c594a529af81ef1c8557`.
This review does not change or merge that draft PR. Its accepted A1–A6 contract and
pending A7 hosted campaign remain separate. M6 cannot substitute for A7, M4
migration, M5 mixed-version qualification, or acceptance of breaking runtime work.

Frozen input: `/tmp/strata-major-plan-review-20261022/docs/M6-RELEASE-CHANNEL-PROPOSAL.md`.
That proposal remains unchanged. Its old input-boundary and readiness-lookup defects
were fixed in PR #328; this review does not reopen them as unfixed findings.

Existing ownership is useful and should remain concrete:

- `stable-version.ts`: canonical stable numeric tuples.
- `bump-version.ts` and `bump.ts`: text transformations and the five-package edit/install adapter.
- `release-readiness.ts` and `verify-release-ready.ts`: policy checks and operator preflight.
- `published-package-versions.ts`: validated registry reads; unknown state is an error.
- `renderProjectMetadata.ts`: generated dependency metadata, not runtime registry selection.
- `release.yml`: trusted npm, GitHub release and container effects.

M6 adds one small pure release-policy owner used by these adapters. It does not
create a generic publisher framework, replace Bun SemVer, widen package exports,
alter application/ORM behavior, or regenerate existing apps.

## 2. Findings and evidence

### Confirmed compatible defect: final publish-step registry lookup

The existing workflow treats every unsuccessful `npm view name@version version`
as permission to attempt `npm publish`. A missing version and an unavailable
registry therefore take the same branch. This is distinct from the already-fixed
readiness CLI lookup and can occur after a successful earlier operator check.

The native npm 11.20.0 read-only experiment uses a disposable loopback registry,
empty owned npm configuration/cache and no credentials. It confirms a successful
exact lookup exits zero, while an absent version and HTTP 401/404/429/503 all exit
nonzero. See `native-npm-lookup.json` and its retained executable probe.

The regression suite executes the actual Bash function extracted from the
workflow. Its npm publish command is a recording-only stub, never a real publish.
Before correction, the two normal controls passed and nine negative cases failed:
four HTTP statuses, a disconnected registry, malformed JSON, missing/array version
maps and a mismatched package identity all attempted publication. The same eleven
tests pass after the local correction. This proves the erroneous decision, not
that npm permitted an overwrite, a remote incident occurred, or credentials failed.

The local fix in `snapshot/` replaces only this decision with a private stable-only
CLI that reuses `fetchPublishedVersions`. An authoritative exact version is skipped;
an authoritative absent version permits the unchanged publish command; unknown
state aborts. Explicit shell error handling also works when the function is called
from a conditional. An unexpected helper result aborts and a publish failure is
propagated. No prerelease parser, channel flag, version, npm argument, GitHub release
setting, container tag or runtime behavior is changed by this compatible correction.

Validation completed on Bun 1.4.4 (`38afee6c8`):

- Unchanged baseline: 72 tests passed, zero failures, 175 assertions.
- Same regression: RED 2 passed / 9 failed; GREEN 11 passed / 0 failed.
- Final combined suite: 93 passed, zero failures/skips, 226 assertions in four files.
- Root TypeScript check and scoped Biome check passed.
- The initial baseline attempt hit a sandbox cache-write error, with 71 passes
  and one failure. It is retained; rerunning unchanged code with an owned Bun cache
  passed. That failure is environmental, not a framework regression.

Full coverage/E2E/CI are NOT run or claimed for this snapshot. The patch is local,
uncommitted and not applied to either framework checkout. A focused tooling PR
would still require the repository's complete gates before remote review/merge.

### Baseline capability gap, distinct from a stable bug

At the reviewed baseline, stable helpers and CLIs intentionally rejected
prereleases and the full build validator assumed stable metadata. Stable operator
defaults still reject prereleases; M6 adds explicit next adapters and a separate
read-only build validator. Simply relaxing that parser would be
unsafe: npm publication has no explicit next tag; the GitHub action has no explicit
prerelease/latest policy; the container job unconditionally updates `latest`.
M6 must wire all adapters before a prerelease is eligible.

The unchanged stable transformation helpers match stable-only versions/carets. Accepting an alpha
input without changing those transformations would leave later alpha-to-alpha or
promotion edits incomplete. This is a future implementation obligation, not proof
that a supported stable bump is broken. The generated dependency owner and existing
literal starter assertions must both remain covered.

### Characterization and remaining uncertainty

`native-semver-characterization.json` records seven ordering and four range results
on actual Bun 1.4.4. Expected alpha numeric order, alpha/beta/rc/stable precedence,
safe-integer boundaries and exact-version exclusion all pass. A prerelease caret
range permits another alpha, supporting exact candidate pins. Native SemVer also
accepts leading-zero inputs rejected by our policy: validate syntax first, then use
Bun ordering; do not use native range parsing as a canonical-input oracle.

An existing-version key alone does not prove a retry is using the same package
bytes/source. Existing stable skip behavior is retained by the compatible fix;
new prerelease recovery needs an explicit artifact-identity contract below.
There is no evidence here of an actual package collision or tampered release.

The baseline workflow ran full validation and matched package versions to its tag,
but its generic build readiness call did not establish fresh actual-main,
exact-head CI or registry state. M6 now enforces this separate preflight before
validation and again immediately before publication. The generic read-only build
check remains distinct from release authorization.

## 3. Accepted local contract P1–P6

### P1. Narrow grammar; stable APIs remain stable

The first next policy accepts exactly `M.m.p-(alpha|beta|rc).N` with canonical decimal
components and sequence number, each from zero through `Number.MAX_SAFE_INTEGER`.
Zero is valid. No prefixes, leading zeroes, whitespace in package metadata, build
metadata, uppercase labels or additional identifier chains. This is an intentional
subset of SemVer, not a claim that other SemVer strings are invalid universally.

Reuse stable core validation and Bun native ordering after the new grammar check.
Existing `parseVersion`, `compareVersions`, `parseReleaseTag`, default stable CLIs,
tuple results, supported CLI outer whitespace and prerelease-refusal assertions stay
unchanged. Prerelease adapters are explicit opt-ins; unsupported inputs fail before
file writes or publication effects. A future expansion requires new qualification.

### P2. Five packages, one next channel, no selected version

The selected experimental npm policy is `next` for all five packages. No actual
version is selected or reserved; `3.0.0-alpha.1` is only an example. The package
versions, tag, internal package peers and generated candidate dependencies must
agree exactly. Workspace links remain workspace links and third-party pins stay
unchanged. Stable scaffolds retain their existing caret behavior.

Publication is not atomic across npm packages. Publish in existing dependency order
and complete all five before declaring a candidate available. Verify every exact
version, digest and channel pointer afterward. Consumers and qualification commands
use the exact candidate, not a mutable next alias. Partial publication remains
incomplete even if some new versions can already be downloaded.

### P3. Explicit entry and one workflow identity

Implemented opt-in tool entry: `bump <candidate> --channel next` and
`release:check v<candidate> --channel next --check-npm`. Omission means stable;
channel/version disagreement is an error, not an inferred fallback.

For the first prerelease, use manual dispatch in the existing `release.yml`, with
a reviewed `channel` choice defaulting to stable. Exclude hyphenated tags from
automatic push publication, so creating an annotated candidate tag does not start
a stable-policy publish. Ordinary stable tag publication retains its existing flow.
Dispatch with `channel=next` is the explicit prerelease action. Do not create a
second workflow filename or silently change trusted-publisher registration.

Before any effects, fetch actual origin/main, verify the exact approved release
commit/tag relationship and five-package metadata, fresh exact-head quality/security
checks and registry state. A moved source head requires revalidation. No bypass,
prerelease-branch target or assertion weakening is introduced. Serialize publication
per channel without cancelling an active release; do not rely on that to protect
against external registry writers. Keep GitHub-hosted OIDC, provenance, suitable
Node/npm versions, and no long-lived publishing token.

### P4. Policy feeds all effects; next never promotes stable pointers

The same validated policy result supplies npm `--tag next`, GitHub
`prerelease: true` / `make_latest: false`, and only the versioned prerelease
container tag. No mutable prerelease container alias is needed for the first
candidate. It must not update npm `latest`, GitHub latest, or container `latest`.

Keep the effects in their current adapters. The policy describes decisions; it
does not perform npm, GitHub, Docker, network or filesystem operations. Tests must
execute the resulting command/condition paths for all three adapters, rather than
only assert strings in YAML or pure object properties.

### P5. Reviewable edits, explicit promotion, no consumer mutation

The next bump must transform stable-to-alpha and alpha-to-alpha metadata, exact
internal peers, starter/create-strata output, expected-version checks and package
notes coherently and idempotently. The source metadata renderer must embed the
candidate at build time; a shipped starter must not import repository scripts or
discover a mutable registry channel at generation time. Validate edits before
writing, then verify native installs/dedupe and actual generated consumers.

Stable promotion is a separate explicitly selected operation after M1/A7 and the
major migration/rollback gates are accepted. Recommend an explicit promotion mode
that verifies the stable counterpart of the current candidate and deliberately
restores stable scaffold/peer policy. It creates new immutable stable artifacts;
it does not move an alpha package into a stable version or happen automatically
when an rc is published. Preserve stable helper APIs even while the new adapter
can inspect a prerelease source manifest. The precise flag is an implementation
detail to review with its tests, not an authorization to promote.

No existing app is rewritten. Existing apps deliberately adopt source/config/package
changes with M4 upgrade/downgrade checkpoints. No deprecation removal or support date
is invented by a prerelease tooling change.

### P6. Fail-closed retries and nondestructive recovery

Before a new next publication, pack the five final artifacts once and retain a
source/version/manifest/digest ledger as a workflow artifact. Publish those exact
bytes with provenance. Qualify that path before replacing any existing behavior;
the first next path need not alter stable publication commands.

A retry may skip an already-published candidate only after its registry integrity
and recorded source/manifest identity match the retained candidate artifacts. If
identity is absent, inconsistent or unavailable, stop. If original bytes cannot be
recovered, do not guess from the version string or overwrite a version. Existing
stable resume behavior stays separate unless a compatible follow-up is approved.

Before effects record existing next pointers, stable pointers and the versioned
container digest. After a partial failure, inventory what actually succeeded; never
report five-package acceptance from one success or retry the whole release blindly.
Any separately authorized channel rollback checks that each current pointer is
still owned by this attempt, then restores its previously recorded value. If a
previous next pointer was absent, removal needs explicit approval and ownership
checks. A concurrent/foreign change is a stop condition. Never unpublish, replace
immutable versions, delete unknown artifacts, collapse an image manifest, erase
Redis state or undo application schema history. Application rollback belongs to M4/M5.

## 4. Implementation and validation sequence

1. Finish the compatible publish-decision patch as its own focused tooling change.
   Preserve the RED receipt; run mandatory full gates and exact-head CI when moving
   it into a real branch. No runtime version bump is needed for tooling alone.
2. Add the pure policy/input owner and adapter tests with TDD. Cover every label,
   zero/boundary/leading-zero case, malformed core/sequence, unsupported metadata,
   channel disagreement and native ordering in both directions. Retain all old
   stable tests unchanged; a new next path must not weaken their expectations.
3. Add bump/generated-package support. Exercise native fresh/frozen installs and
   dedupe for stable-to-next, next-to-next and explicit promotion; verify all five
   manifests, peers and generated app locks. Compile and run installed consumer
   contracts against packed artifacts without source aliases or package patches.
4. Wire the three workflow adapters and retry ledger. Run a no-credentials execution
   harness over actual job/step conditions and command arguments: stable, next,
   malformed policy, unknown registry, each package failure, existing matching/
   mismatching bytes, omitted outputs, interrupted resume and foreign pointer change.
   Fake clients record effects; native read/pack checks remain separate. Dist-tag
   commands are excluded entirely from local dry runs, not merely given `--dry-run`.
5. Run the full required type/package/export/compiler/coverage/E2E gates sequentially,
   inspect source and resource receipts, and obtain exact-head CI/review. Only a
   separately approved candidate publication can test live OIDC, npm/GitHub/GHCR
   pointers and recovery. Verify all original published profiles plus new candidate,
   M1 and upgrade/rollback contracts with zero failures/skips and owned cleanup.

Local test evidence is not hosted A7 acceptance, an actual trusted-publishing test,
or authority to create a tag, mutate a channel, merge, deploy, or lift #257.

## 5. Primary sources checked 26 October 2026

- [SemVer 2.0.0](https://semver.org/): prerelease syntax/precedence and version
  immutability. P1 intentionally accepts a smaller publication grammar.
- [Bun SemVer](https://bun.sh/docs/runtime/semver): native ordering and ranges.
  Actual runtime receipts above take precedence over assumptions about strict parsing.
- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/): default latest
  tag, immutable name/version, workspace publication and dry-run limits. Do not
  assume a dry-run flag protects other registry-mutating commands.
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/): OIDC, workflow
  filename identity and current runtime requirements. Existing Node24/npm-latest
  workflow remains; exact runner versions must be recorded when qualified.
- [Actual action v2 input definition](https://raw.githubusercontent.com/softprops/action-gh-release/v2/action.yml):
  explicit prerelease and make_latest inputs. Do not infer v2 behavior solely from
  the repository's current default-branch README.

## 6. Implementation notes and validation boundaries

The private policy has no I/O. Existing stable helpers retain their signatures and
valid results; next bump/readiness adapters opt into the additional grammar. The
shared bump plan and install owner avoid copying file-writing logic. The artifact
owner reuses release readiness for exact peers, validates regular owned paths and
checks manifest/archive identity. The publication coordinator receives explicit
registry and executable dependencies. Production effects are reachable through the
checked workflow adapter; tests use explicit recording executables, never an
ambient PATH assumption.

Temporary Git repositories also clear inherited `GIT_*` settings and ignore global
and system Git configuration. A subprocess working directory alone cannot isolate
Git commands launched by a push hook. The real-Git contract runs with a disposable
caller's hook variables injected and verifies that its refs, HEAD, index,
configuration and source bytes remain unchanged.

Build validation recognizes only the two supported canonical metadata formats. It
is read-only and cannot authorize a channel or publish. The operator `release:check`
still defaults to stable. One existing stable CLI test now initializes an owned
stable workspace so it remains meaningful on a candidate checkout. All 27 original
assertion expressions are AST-identical; no expectation was relaxed. The candidate
checkout reproduction and its corrected run are retained separately.

The policy job verifies source cleanliness (including nonignored untracked files),
annotated tag, actual-main SHA and all four newest exact-head checks. Effect jobs
checkout that verified SHA, preventing a later ref movement from choosing different
source. Policy outputs are emitted only after every check succeeds. Before npm
publication, source/checks and the original channel baseline are verified again.

Next uses the existing trusted workflow identity and no new secret-based publisher.
It retains all five original archives and a source/manifest/integrity ledger before
uploading. A separate dispatch at the same candidate tag can select the original
run ID. Recovery verifies that run's repository, workflow, event and source, then
verifies every retained archive and current manifest. Unknown metadata and changed
pointers stop rather than grant permission to publish. Attempt files preserve both
partial counts and failed outcomes; a lost acknowledgement can be resumed by
observing the matching immutable bytes rather than publishing them again.

Next captures stable GitHub and container pointers before effects, checks them
around the adapters, and records the versioned container digest without rebuilding
or flattening the stable manifest. Registry metadata must be readable with the
workflow's existing GitHub identity. HTTP 404/permission errors are unknown state,
not permission to create/overwrite a container package. No PAT fallback or implicit
grant is added. Actual token/package-visibility behavior remains a live workflow
qualification gate.

An existing next image tag deliberately stops for identity review. npm recovery is
automated from retained archives; adopting a previously pushed image after a later
SBOM/job failure is not automatic. Its recorded digest can support separate review;
this implementation never overwrites it merely to make a retry green. The first
candidate uses a versioned image only. Recovery of external pointers is a separately
authorized operator action, not a new automatic rollback feature.

The registries do not provide an atomic transaction over these effects. Metadata
checks detect observed changes; they cannot impose compare-and-set behavior on an
independent writer. An actual campaign requires exclusive publication ownership of
this candidate namespace and the existing per-channel workflow lock. Concurrent or
foreign changes are never automatically restored. Stable metadata, image manifests,
source/app locks and data remain available for a deliberate rollback decision.

Local qualification includes the same stable assertions, negative policy/registry/
ownership cases, real native installs/packing, native Git source cases, actual Bash
adapter execution against recorders, and a synthetic candidate's complete generated
compiler matrix. The installed wrapper is also exercised outside source aliases
with exact local tarballs, public migrations and ORM operations. Those are local
packed-consumer results, not published, hosted, browser or OIDC acceptance.

The retained local evidence is under `/tmp/strata-m6-review-20261026`: RED/GREEN
logs, `original-assertions-proof.json`, frozen public package manifests/archives,
compiler/wrapper receipts, source proofs and the final validation/cleanup report.
The first publication still requires focused review, all required exact-head CI,
actual-main release checks, unused versions/absent tag at the appropriate stage,
explicit publication authorization, then live exact-version/channel and consumer
qualification. Source tests cannot substitute for those steps.

## 7. Remaining authorization and programme work

P1–P6 local implementation and opening this review PR do not authorize merge,
selecting a release version/tag, moving channels, publication, deployment, hosted
provisioning, application adoption or restarting the timer. Stable promotion remains separately
selected after the major acceptance gates; an rc never promotes itself.

A7 still needs the operator's provider/account and bounded operational approval.
The accepted M1 contract, draft PR #377, M4/M5 upgrade/mixed-version/rollback gates,
original framework checkout and separate app remain independent. Native assets are
not adopted by existing apps through this tooling change. Shop adoption remains
held for #257 and the timer stays off.
