# M1 contract and adoption proposal

26 October 2026. A1–A6 approved by the human, including the focused export change. The reviewed baseline is PR [#377](https://github.com/EyK-26/strata/pull/377), head `306dc48a607de8bba22f41796db08dbffa16d773`. A7 and its operational execution remain unapproved.

The approved A1–A6 decisions establish the bounded M1 review contract below. Hosted qualification, merging, publication, deployment and application adoption remain separate decisions. The separate app stays unchanged, shop adoption stays **held for #257**, and the timer stays **off**.

## 1. Decisions already settled and evidence available

The chosen architecture is an **explicitly public artifact origin** plus a guarded application listener. Public delivery does not acquire application authentication, tenancy, ORM access or per-request application interception. Protected downloads and HTML remain application responses. This choice is retained.

Independent review closes F1, F2 and C1 within their documented scope. All four checks on the named head passed: [CI](https://github.com/EyK-26/strata/actions/runs/40330301617) and [Security](https://github.com/EyK-26/strata/actions/runs/40330301541). Ubuntu recorded 3,133 unit/integration passes, two existing platform skips, zero failures, 74,575 assertions, 161 coverage files enforced at 100%, 272 unchanged exemptions, all 201 E2E passes and all 30 generated-app compiler combinations. The separate local macOS gate recorded 3,132 passes and three existing platform skips. Neither result is a hosted-provider or production-adoption certificate.

The reviewer independently ran 137 M1 tests and five probes. PostgreSQL, packed-install and compiler evidence was reviewed but not independently rerun. Historical browser, TLS and populated-app rollback evidence remains identified in the [qualification report](M1-QUALIFICATION-2026-10-26.md); it is not silently relabeled as a campaign on the current head.

Confirmed defects stay separate from compatibility guarantees. A new defect discovered during implementation or qualification must receive a reproduction, desired-behavior regression, smallest justified correction and the affected gates. A green characterization is not evidence that the original implementation is bug-free. Existing assertions, failed controls and logs stay intact.

## 2. Public API and compatibility decisions

### A1. Approve a deliberate M1 entrypoint

Recommend keeping the following application-facing functions under `@getstrata/bootstrap/m1`:

- `collectPublicArtifactManifest` and `verifyPublicArtifactFiles` for producer-owned output capture and verification.
- `createPublicArtifactResolver` and `prepareDocumentArtifacts` for approved delivery destinations and a same-build document plan.
- `defineApplicationRoutes` and `startGuardedApplication` for typed route declarations and application startup.
- `describeM1Failure` and `getM1StartupCleanupCompletion` for bounded diagnostics and cleanup observation.

Retain `M1ConfigurationError` and the associated manifest, resolver, route, module, renderer, options, diagnostic and cleanup-outcome types. Preserve native Bun request/server typing and existing driver, SDK, DI-token and protected ORM extension identities. Do not introduce another container, router, publisher abstraction or ORM mechanism.

**Approved export refinement.** The reviewed baseline's wildcard export also exposed `HTTP_METHODS`, `routeShape` and `validateGuardedRoutes`. The focused follow-up keeps these implementation helpers internal and replaces wildcard exports with the explicit application-facing list and associated types. No helper implementation or route behavior changes. Installed positive/negative type contracts fail on the baseline and pass after this refinement on all three compilers; the packed runtime likewise rejects the baseline's extra exports and accepts exactly the nine retained runtime exports. The normal gate and new exact-head CI are required for this delta; the earlier green CI remains baseline evidence only.

All existing published 2.x entrypoints and supported protected extensions retain their contracts. Installing a package does not regenerate an application or switch its listener. Do not promise stable compatibility for an unpublished M1 prototype until the selected API is accepted and its release policy is implemented.

Keep the existing Bun minimum of 1.4.4. Current runtime evidence uses Bun 1.4.4; accepting a later 1.4.x under the package range does not turn it into a tested runtime. Retain the existing three-compiler gate and qualify a changed runtime/browser combination before extending its guarantees.

### A2. Approve strict guarded routes and document capabilities

Recommend the current conservative declaration grammar: absolute ASCII paths, unique named parameters, a terminal wildcard, no encoded declaration aliases or traversal segments. Case and trailing slash remain significant. API prefixes cannot contain parameters or wildcards.

A duplicate matching shape across modules or API/web groups rejects startup even when the methods are disjoint. Declare all methods for one shape under one owner. A bare callback means GET; a reusable `Response` covers the six non-OPTIONS methods. Explicit method maps use the seven declared methods. Native HEAD fallback and framework OPTIONS appear in the route inventory. Do not add an override mechanism without a concrete consumer and its own acceptance.

This is a duplicate-shape check, not a complete overlap detector for every wildcard/static/parameter combination. Plain JavaScript composition can also overwrite a duplicate key before collection sees it. Recommend retaining native dispatch precedence for valid distinct shapes, inspecting the complete application route inventory during adoption, and making no universal collision/provenance claim. A stronger declaration API would need a separate demonstrated requirement. Native server typing likewise does not prove that a callback never calls `upgrade`; these HTTP guarantees do not qualify mixed HTTP/WebSocket completion.

Guarded routes accept callbacks, reusable Responses and method maps. They reject opaque native HTML bundles, directory maps, files and `false` as route declarations. A deliberate public manifest or a guarded file Response is the migration choice. The listener disables implicit working-directory public-file fallback.

Web routes require an actual renderer capability. M1 applies configured flash/CSRF document middleware automatically, including when an application's frontend label is API. Domain authentication, authorization and tenant restrictions remain explicit in the existing kernel, policies and ORM; calling the M1 entrypoint does not invent a domain policy. App URL, host admission, CSRF target origin and proxy trust retain their existing security contracts.

### A3. Approve metadata and lifecycle ownership

Recommend one application runtime owner per process. M1 checks context ownership after route collection and again after metadata publication, before binding. Publication uses the existing registry identity, copied plain/null-prototype data, frozen snapshots and conditional restoration. Accessors, cycles and non-data values are rejected for that snapshot operation. Arbitrary registry-hook or module-import side effects are not transactional.

Successful shutdown restores only the owned metadata revision and releases only its startup reservation. Failed drain, flush, close or changed metadata ownership remains a failure. A foreign context is never disposed by M1. Starting M1 over a legacy context is rejected; unchanged legacy entrypoints do not prevent a later caller from replacing the global context. **Mixed owners are unsupported, not mutually isolated by this prototype.** Supporting multiple runtimes needs a separate justified ownership design.

Recommend accepting the implemented C1 contract without adding another provider API to M1 now:

- `startupCleanupTimeoutMs` defaults to 30,000 ms and validates before acquisition. It is independent of ordinary shutdown timeout and production leases.
- Once a context has returned, one owned stop/dispose/conditional-restore/release sequence continues after caller timeout. Timeout is not cancellation or permission to retry.
- Both timeout and timely cleanup-failure aggregates have a stable completion handle. Completion resolves a frozen `cleaned`, `cleanup-failed` or `metadata-conflict` outcome and never rejects. Delivered causes and diagnostics do not change later.
- Failed listener stop prevents provider disposal. A released reservation says nothing about another active owner. Unknown errors provide no cleanup certificate; internal completion errors are not sanitized transport data.
- Acquisition without a returned context, synchronous/native stalls and never-settling cleanup require external process supervision. Failed or unobservable ownership requires investigation/process recovery, not another in-process attempt. The operator chooses a total startup/recovery budget consistent with real workloads; this proposal does not shorten leases or claim a safe universal kill interval.

See the [implemented C1 contract](M1-C1-BOUNDED-STARTUP-CLEANUP.md). Supporting observable provider-acquisition disposition later is a separate contract decision with real consumers and tests.

## 3. Artifact and browser guarantees

### A4. Approve a bounded integrity contract

Recommend manifest format 1: a build identity and explicitly selected logical names mapped to relative path, media type, byte count and SHA-256. The current validator excludes HTML/source maps and rejects invalid paths, duplicate destinations and unsafe manifest data. Application policy supplies the approved HTTPS origin and build-specific prefix; a manifest cannot select its own host. HTTP is allowed only through the explicit loopback test option.

Capture native outputs under producer ownership and retain the manifest. Verify those files immediately before publication. A native artifact is file-backed: capture does not attest an immutable compiler buffer, and recollecting changed bytes is not verification of an earlier build. Verify stored and delivered objects against the retained digest; provider ETags are not substituted for SHA-256.

The recommended first supported document subset is **declared window JavaScript modules and entry stylesheets**. Use a same-build plan, put the complete supported window-module integrity map before every module request/preload, use entry integrity and anonymous CORS attributes, and preserve the actual CSP nonce. Emit escaped script data through the reviewed renderer pattern.

The operator/producer must inventory every supported dependency edge. A manifest is an output inventory, not proof of complete graph closure. Workers and their children, CSS-referenced fonts/images, WASM, arbitrary dynamic URLs and unknown edges do not acquire browser integrity enforcement merely by appearing in it. Exclude those from the initial integrity guarantee; do not label all manifests unsupported or pretend those resources cannot be delivered.

Use the pinned Chromium/Firefox/WebKit Linux fixture matrix as the initial candidate qualification target. It is not a claim about every browser release, shipping Safari or macOS Firefox launch. Keep the original preload-before-map failures and diagnostic mismatches visible. Bun's native 64 MiB delivery and mixed HTTP/WebSocket completion limitations also remain explicit; hosted large-file success does not fix either or lift #257.

## 4. Adoption, deprecation and rollback

### A5. Approve deliberate source migration

Recommend this sequence for each future adopting app; it does not authorize changing either existing app in this task:

1. Inventory its exact package lock, generated/custom source, routes and effective methods, metadata hooks, wrappers, request/maintenance hooks, logging/tracing/metrics, public roots, cookies, providers, workers, persisted formats and deployment topology. Classify each exported path as guarded, explicitly public or unsupported. Never auto-publish an old opaque value. A file that must obey an application denial or maintenance hook stays guarded; provider logs cannot manufacture its missing application request/tenant context.
2. Record a working baseline and rollback copy: exact package/lock and source/config, route/OpenAPI inventory, populated ORM rows, sequences, tenants/RLS, sessions/CSRF and external-effect identifiers. M1 itself requires no schema migration; separate any application schema change and qualify its own downgrade implications.
3. Move one complete process to the M1 owner. Keep public shared context/token imports; remove duplicate legacy `kernel.wrapWeb` processing where M1 now owns flash/CSRF. Recheck auth, host admission, tenant policies and negative cases. Do not run legacy and M1 owners together to simulate a gradual in-process cutover.
4. Publish and verify the complete selected immutable artifact graph first. Then select the matching manifest, document plan, app source and package set together. Switching the app must not select a partial release or overwrite an old artifact URL.
5. Rehearse candidate adoption and rollback with populated data, a candidate-written row, existing sessions/CSRF, real provider drain and old/new browser clients. The prior owned cookie/Eta/SQLite rehearsal establishes that bounded case, not every app's providers or data migrations.

Recommend **no 2.x deprecation or removal in this PR**. Keep replacements opt-in and establish the final API, supported environments, migration guide and observed consumer qualification before announcing a removal schedule. A future removal is an explicit major-version decision; no silent generator change or automatic app rewrite counts as adoption.

### A6. Approve a rollback contract with retained assets

Retain exact old source/config/package/lock and complete immutable A/B artifact graphs. Stop new admission/producers, drain/fence owned work using existing lease policies, then restore the old process and matching document/manifest selection. Never run two owners in one process during rollback. Confirm the old app's readiness and negative security controls.

An A→B→A selection must preserve old A and B deferred imports for already-open clients. Recommend no automatic asset retirement during initial qualification. Before production, the operator must choose a measurable maximum supported client/rollback window and a retention policy covering it; object age alone is not permission to delete a graph.

Already committed rows, outbox work and external effects remain committed. Preserve additive data and migration history; reconcile uncertain outcomes instead of replaying blindly. A package rollback is not a database restore. If an artifact was wrongly classified public, stop promotion, withdraw its exposure and perform the required incident/credential response; reverting app code cannot make already disclosed bytes private again.

## 5. Hosted delivery proposal and acceptance

### A7. Approve provider design separately from provisioning

Retain the [staging-provider proposal](M1-STAGING-PROVIDER-PROPOSAL.md). Recommend a dedicated private S3 bucket and public CloudFront artifact hostname with origin access control, if account/DNS ownership and the cost review fit. Use a normal bucket origin and OAC that always signs origin requests; AWS documents that setting's HTTPS origin behavior. This is a provider design recommendation, not an existing configuration. [AWS OAC documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

Use conditional immutable key creation, and test collision/failure recovery. Configure CORS forwarding and cache variation together at the actual edge. Those capabilities have provider-specific conditions; the documentation does not prove a selected account is configured correctly. [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [CloudFront CORS and cache behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html).

If the operator already owns an appropriate Cloudflare account/DNS zone, review R2 with a custom domain instead. Its development endpoint does not qualify the proposed cached delivery arrangement. [R2 public-domain documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).

The app runtime receives no publisher/admin credentials. Use a narrowly scoped operator identity and receipt-owned cleanup through the provider's supported tools. Choose cookie-isolated hostnames; a sibling hostname or different port alone does not establish isolation. Public artifacts must contain no private/tenant data. Keep application authorization and CSRF on the guarded listener.

### Hosted acceptance criteria

Register the actual provider cases before execution, preserve all existing assertions and negative controls, and record exact source/package/build/manifest, runtime/browser versions, policies and owned resources. Each registered case must execute with its expected assertions and no unexplained failure or skip:

1. Validated HTTPS, certificate/unknown-host negatives, MIME and stored/decoded-delivery byte count and SHA-256. JS/CSS execute under the intended CSP; tampering is rejected within A4's supported subset.
2. Approved/unapproved Origin, preflight/cache variation and no app cookie or viewer Authorization forwarded to storage. No asset response sets an app session cookie. App form GET/cookie/token/POST and host/CSRF negatives still pass through real TLS termination.
3. GET/HEAD, valid/invalid ranges, conditional/missing-object/method behavior, compression, redirects, interrupted and large transfers. Record edge/origin observations, not synthetic per-request app tracing for public delivery.
4. Partial upload, concurrent immutable-key collision, verification failure and cleanup failure. The old selected release remains usable. Cleanup touches only objects proven created by that attempt and preserves the primary failure separately.
5. Old A/new B clients, A→B→A selection, retained deferred assets and intentional missing-old-chunk failure without cross-build fallback. No retirement by age during the exercise.

Execution still needs the delivery/account/DNS owner, region, dedicated resources, exact app/artifact hosts and cookie policy, approved credential-supply method, scoped permissions, supported client/retention windows, traffic/storage/logging inputs for cost review, and explicit permission to provision and run this matrix. Do not send secrets in this proposal or introduce a framework deployment layer to fill those gaps.

## 6. Approval and completion order

1. **Contract approval complete:** the human accepted A1–A6, including internalizing the three helpers. This selects the public surface, strict behavior, supervised limits, browser subset and migration/rollback policy.
2. **Focused implementation follow-up:** the explicit export boundary now has installed type and runtime regressions. Complete the required normal gate and new exact-head CI before treating this delta as qualified. Reassess any actual new defect separately; retain all F1/F2/C1 assertions. Do not rerun unrelated completed campaigns without a change that justifies it.
3. **Hosted approval and qualification:** accept A7 and supply the operational inputs before provisioning. Complete the actual registered hosted cases and owned-resource restoration. Local nginx evidence cannot close this gate.
4. **Merge decision:** review the accepted contract, current exact-head code/CI and complete qualification together. Keep #377 draft until those conditions are met or a different explicitly bounded review-only merge policy is accepted. No merge is authorized by this proposal.
5. **Publication decision:** agree the version/channel policy separately. Recommend exact coordinated five-package prerelease pins on an isolated channel before major adoption. The existing M6 proposal remains unimplemented; current stable tooling must not be assumed to support that channel. Preserve stable defaults and trusted publication, qualify the channel tooling before use, and run official checks against actual green main, verify unused versions/absent tag and exact published consumers when publication is authorized. No version, date, tag or channel move is selected here.

Shop adoption remains held for #257 regardless of M1 review approval. The separate app remains unchanged. Neither approval of this contract nor successful staging qualification automatically authorizes application migration or deployment.

## Source references

- [Current M1 exports](../src/bootstrap/m1/index.ts), [route declarations](../src/bootstrap/m1/guardedRoutes.ts), [startup and ownership](../src/bootstrap/m1/application.ts), [cleanup observer](../src/bootstrap/m1/startupCleanup.ts).
- [Manifest schema](../src/bootstrap/m1/artifactManifest.ts), [producer capture/verification](../src/bootstrap/m1/artifactFiles.ts), [resolver/document plan](../src/bootstrap/m1/publicArtifacts.ts), [safe diagnostics](../src/bootstrap/m1/diagnostics.ts).
- [Prototype API/adoption notes](M1-LOCAL-PROTOTYPE.md), [historical qualification](M1-QUALIFICATION-2026-10-26.md), [C1 contract](M1-C1-BOUNDED-STARTUP-CLEANUP.md), [hosted-provider proposal](M1-STAGING-PROVIDER-PROPOSAL.md). Earlier frozen design and failure evidence remains unchanged.
