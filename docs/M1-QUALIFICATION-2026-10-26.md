# Local M1 qualification follow-up

This records the pre-commit local qualification of the prototype at base `a87baf0`.
The human subsequently authorized submitting this implementation as a draft PR
for review. That submission does not approve the major contract.
It does not approve the provisional major API or constitute a release, deployment,
hosted-provider acceptance, or adoption by an existing application. The separate
app has not been accessed. Shop adoption remains held for #257; the timer is off.

The complete item ledger and raw successful, failed and incomplete attempts are
retained in `/tmp/strata-m1-qualification-20261026`. Historical design inputs,
earlier RED evidence, and original test sources remain intact. The earlier 3,077
unit/integration and 201 E2E result belongs to the previous prototype tree; the
new final gate must be read from this qualification's own outcome receipt.

## Confirmed defects corrected in the prototype

**F1 — acquisition ownership.** A failing HTTP lifecycle registration could throw
after native listener acquisition, leaving no returned server handle for cleanup.
The synchronous server API now registers its fallible ownership callbacks before
`Bun.serve`, unregisters only the acquired callbacks if binding fails, and retains
primary and cleanup causes. Tests cover all three registration positions, no
listener acquisition, caller-owned lifecycle callbacks, metadata/provider cleanup,
and corrected restart. The pre-existing later post-bind failure assertions remain.

**F2 — production guard parity.** M1 omitted the existing production-secret guard.
It now calls the public guard before providers or startup reservation. Unsafe
session secrets, development auth and local production origins fail before resource
acquisition. Corrected production settings and the unchanged cold-import RED probe
pass. The latter runs from a separate copy; the original failed evidence is retained.

**F3 — native handler typing.** A bivariant callback alias admitted request handlers
requiring stronger application preconditions than native Bun provides. The type is
now the native handler type. Literal parameters and `Server<Data>` stay inferred;
extra required request properties and mismatched prepared server-data types fail.
The installed contracts pass TypeScript 5.9.3, 6.0.3 and 7.0.2 without source aliases.

## Readability and boundaries

**R1.** Startup delegates document preparation and route collection to private phase
helpers. Pure manifest validation, build-time file verification and runtime URL/view
data have separate owners while existing exports remain available. Prepared route
maps are immutable and privately recognized, so a validated callback is compiled
once. Static Response bodies are rechecked for consumption or locking at reuse.
No second router, provider hierarchy, worker, publisher or module loader was added.

**R2.** Metadata uses one indexed inventory. `describeM1Failure` returns bounded
stage/code/field/logical-owner labels and static migration guidance. It reads a
private immutable diagnostic snapshot rather than arbitrary Error getters, messages,
causes or stacks. Original internal thrown objects and causes are preserved.

## Lifecycle and entrypoint characterization

**C1.** Real restricted PostgreSQL requests cover connected and disconnected clients,
forced RLS, isolated tenant settings, ORM inserts, nested savepoint rollback, and
deferred observers that read committed rows before telemetry flush and pool close.
Successful shutdown restores metadata and allows corrected startup. A deliberately
invalid native `SQL.close` timeout proves that a real close-API rejection leaves
the pool live, reports failure and blocks automatic retry. This is deterministic
fault injection, **not** a claim of spontaneous network-close failure reproduction.
All test-owned tables are dropped; migration and runtime identities remain separate.

A provider rejection before returning a context still supplies no structured
cleanup disposition. The reservation deliberately remains held, even if a fixture
independently observed its resource close. Failed drain/close and unresolved
ownership require investigation/process recovery, not blind automatic retry.

**C2.** Starting M1 while a legacy context exists is rejected. The reverse direction
is not intercepted by the unchanged legacy API: a later caller-created legacy
context can replace the process-global context and stays caller-owned after M1
shutdown. Both directions and deliberate cleanup/restart are characterized. This
does not establish mixed-entrypoint support. Adopt one application runtime owner
per process. Module import side effects, arbitrary registry-hook side effects and
externally acquired workers are not transactionally rolled back.

The major adoption policy must also review frozen/plain metadata, hook behavior,
strict path/method rules, shape collisions even for disjoint methods, and replacing
legacy `kernel.wrapWeb` calls with M1's automatic document flash/CSRF composition.
Existing 2.x entrypoints retain their current behavior; they are not deprecated or
silently rewritten by this prototype.

## Browser, graph and transport evidence

**A1/B1.** The actual prototype's three end-to-end cases pass in pinned Chromium,
Firefox and WebKit in the exact official Playwright 1.64.1 Linux image. They cover
native JS/CSS in real Eta documents, relative APIs, altered deferred-module rejection,
and A→B→A listener restart with old A/B windows retaining their deferred chunks.
Chromium runs with its sandbox enabled under the unprivileged image user and the
official default-deny seccomp profile. No host privacy settings or browser binaries
were modified. Linux Firefox execution resolves the qualification-environment gap;
the macOS launch limitation remains a separate recorded observation.

All 17 original graph cases and 10 preload hypotheses executed for each engine,
with no skips or changed assertions. The graph controls pass 17/17 in Chromium and
16/17 in Firefox/WebKit. Both latter engines retain the failed preload-before-map
integrity control. The diagnostic hypotheses retain 4 Chromium, 5 Firefox and 6
WebKit mismatches; event mismatches are respectively 0, 1 and 5. These red browser
observations are not reported as passed framework guarantees.

The supported target requires the complete declared **window-module** integrity map
before any module request/preload, entry-script and stylesheet integrity attributes,
and anonymous CORS. Preload events alone do not prove that later imports are safe.
Workers and their imported children, CSS-referenced fonts/images, WASM, arbitrary
dynamic URL construction and unknown graph edges do not acquire automatic integrity
enforcement merely because their files appear in the manifest. The API does not
infer complete graph closure; producer/operator selection and retained build evidence
remain necessary. Native output bytes are unchanged in the retained graph runs.

**T1.** Sixteen local TLS checks pass with nginx 1.29.3 and a fixture CA trusted only
inside the disposable browser container. All three engines perform real HTTPS
form GET/cookie/token/POST, native JS/CSS, CSP-nonce and relative-API flows. Negative
controls include missing/invalid tokens, cross-origin/malformed/conflicting Origin,
spoofed forwarding, direct backend host mismatch, unknown ingress Host and an exact
certificate hostname-mismatch rejection. Static delivery covers MIME/digests,
credential isolation, HEAD, valid/invalid ranges, conditional requests, methods,
missing files, gzip decoded-byte equality, redirects, interruption and 70 MiB delivery.

Early TLS fixture failures are retained separately: an individual-file Docker mount
race, a path/config setup error, a string-eval browser helper rejected by CSP, a
body without explicit MIME becoming an nginx download, a valid POST control without
form data, and a HEAD expectation that omitted content-encoding selection. The
corrected harness uses Docker-copy config, CSP-compatible locator checks, the public
UTF-8 `textResponse` helper, correctly encoded forms and identity representation
for length/range checks. No security policy, original assertion or framework
transport was weakened to pass the fixture.

## Adoption, final gates and remaining approvals

**M1.** A new owned generated cookie/Eta/SQLite app successfully rehearses published
2.2.59 → unpublished same-version tarballs → exact published source/package/lock.
The app's original populated ORM rows, an additional candidate-written row, real
database-backed session and original CSRF cookie/token survive. Corrupted sessions
and cross-origin submissions remain rejected. The generated app and database are
removed afterward. Retained A/B browser clients are qualified in the separate
browser fixture; this bounded rehearsal does not promise every app's providers,
extensions, data migrations or deployment topology can roll back automatically.

The initial rehearsal used the wrong session protocol for the generated app and
correctly failed. Its replacement uses the actual generated cookie-session auth
manager and persisted session, after real credential verification. Earlier fixture
type/API-shape failures remain recorded; they were not framework defects.

**G1.** Focused native/type checks, installed strict compiler contracts, original
packed ORM/form/drain assertions and shared source/packed startup ownership checks
pass. The final full coverage/E2E/package/generated compiler gate and its actual
counts are recorded separately in the qualification outcome; previous-tree counts
must not be reused as new proof.

**P1/P2.** The human selected a staging-provider proposal for review. See
[the proposal](M1-STAGING-PROVIDER-PROPOSAL.md): dedicated S3/CloudFront with OAC is
the proposed first option, conditional on the delivery owner/account/DNS/cost review;
R2 with a custom domain is the alternative when that matches existing ownership.
No provider, credentials, DNS, cloud resources or hosted settings have been accessed.
Actual hosted TLS, headers, cache variation, failure cleanup and publication/retention
qualification remains **awaiting proposal approval and staging resources**.

**X1.** nginx's successful 70 MiB transfer does not fix Bun's native 64 MiB delivery
limit. Mixed HTTP/WebSocket completion attribution also remains explicitly limited.
The manifest attests producer-owned bytes when captured; mutable native file-backed
artifacts do not supply a cryptographic original-build snapshot by themselves.

**Z1.** Final preservation and cleanup receipts compare every original test/frozen
input hash, user checkout state and exact Docker IDs. Only label/receipt-owned test
resources are removed. Unknown containers/volumes are untouched. Qualification itself made no commits, pushes or remote PRs. The subsequently
authorized draft submission is separate from those recorded checks. No merge,
publication, deployment or timer restart is authorized.

The prototype is ready for another design review only after reading the final gate
outcome and these limits together. Hosted acceptance and provisional major-contract
decisions remain open; no breaking adoption or release is approved by these results.
