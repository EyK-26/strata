# M1 guarded HTTP and document contract proposal

Status: **design and compiler feasibility only**. No new package export, route
factory, runtime validator, manifest resolver or breaking change is implemented.
The selected major target remains an explicitly public artifact origin. This note
extends the existing M1 proposal without changing the frozen M0/M1/M2 inventory.

## Keep one owner for each boundary

The module declares paths, native callbacks and metadata. The existing route
collector owns prefixing, canonical method/path identity and collision diagnostics.
`HttpKernel` owns middleware and response policies. `createWebServer` owns native
dispatch and lifecycle accounting. The current app-owned `ViewRenderer` owns view
responses. A proposed pure manifest resolver would own validated asset metadata,
not publication or HTTP transport. None needs a second container, router, SDK,
renderer hierarchy or generic provider/publisher framework.

## Proposed finite route values

The isolated [declaration fixture](../scripts/fixtures/m1-http-contracts/proposal.ts)
sketches an illustrative `defineApplicationRoutes<Data>()` factory. Its values are:

- A `Response`, preserving the existing transport's response-cloning ownership.
- A native `BunRequest<Path>, Bun.Server<Data>` callback returning `Response` or
  `Promise<Response>`. Parameter extraction and HTTP method names come from Bun's
  declarations, not a second path parser. Plain `Request` and no-argument handlers
  remain assignable.
- A nonempty map of the seven SDK HTTP methods to those responses/callbacks.

Opaque `BunFile`, imported HTML, directory objects, `false`, empty method maps,
arrays and arbitrary callback results are excluded from this guarded contract.
An existing opaque value must never become public merely through an upgrade.
The migration choices remain an existing guarded file `Response` or an explicitly
selected artifact on the accepted separate public origin.
An ordinary `new Response(Bun.file(...))` stays within the guarded Response path;
the distinction concerns dispatch ownership, not a ban on file content.

The factory is a proposed type boundary, not a promise of new method behavior.
Retain the current 2.x expansion during migration: static responses cover the
existing HTTP methods, bare callbacks use the existing GET registration, explicit
HEAD/OPTIONS remain explicit, and the native/default HEAD and preflight behavior
still needs its exact consumer controls. Any change to those semantics needs its
own before/after decision; capitalized method types do not authorize one.

Require absolute declaration keys in the proposed API. Current 2.x aliases,
lowercase method normalization and last-winner precedence stay on the compatibility
line. A migration must expand existing prefixes, resolve aliases and associate
handler, middleware and OpenAPI metadata before checking canonical collisions.
Report both source owners, original keys, canonical path and method. Reject an
unreviewed collision before opening the listener; do not normalize each component
independently or invent an override merely to hide one.

There is a harder boundary: `{ ...firstRoutes, ...secondRoutes }` can erase a
duplicate key before either types or the collector sees it. The proposed plain-map
factory cannot promise to reconstruct that provenance. Cross-module canonical
collision checks can validate intact declarations; a guarantee covering arbitrary
pre-collection JavaScript composition needs a separately accepted declaration/
collection API. The probe records this counterexample. Do not promise universal
collision rejection based on these types or hide the gap behind a whole-map cast.

## Types have explicit limits

TypeScript's structural typing permits a named object containing a valid GET and
an extra `dir` property to satisfy a method-map shape. Fresh-literal excess-property
checks are not a sealed-object guarantee. Template path types also accept a
query-bearing string. With the current consumer compiler options, an optional
method may explicitly contain `undefined` alongside another valid method.
JavaScript, casts, dynamic configuration and arbitrary
manifest JSON have further limits. The compiler probe records these accepted
counterexamples separately from its positive and rejection controls.

An eventual startup validator must check actual own keys, nonempty method maps,
supported native values, canonical paths/methods and cross-owner collisions. Never
execute callbacks at startup to inspect their return values. If an invoked HTTP
callback returns an invalid value, diagnose it through the existing error/logging
boundary; do not silently reinterpret it as an asset, fallback or successful body.
Exact error types and canonical wildcard/path policy still require review and real
HTTP tests before implementation.

The native server argument retains the SDK's generic data contract, including its
`upgrade` method. A Response-only callback type cannot prove that user code never
calls it. Current 2.x WebSocket upgrade fallback remains supported separately; do
not broaden every HTTP callback to `void` to disguise that distinction. A precise
major upgrade contract and actual mixed HTTP/WebSocket lifecycle acceptance remain
open. These declarations do not repair the known abort/drain ambiguity.

## Capabilities follow providers, not frontend labels

Both API and web contexts retain the real `dependencies`, `cachedJson` and `kernel`
owners. The fixture reuses their existing types and proposes an optional document
capability for API routes, required when configuring web routes that need views.
That capability is `Pick<ViewRenderer, "render" | "renderHtmx">`, not a replacement
view service. Availability must come from the actual configured provider.
Pass the existing renderer instance or its bound namespace facade; copying
unbound prototype methods would lose their engine owner.

An API app can need the guarded cookie-SSO MFA challenge while general HTML login
routes stay absent. A blanket "API has no HTML" type would recreate the corrected
starter composition failure. Conversely, renderer availability does not authorize
a route, enable general web auth, whitelist a template or waive CSRF/tenancy. Those
remain explicit module/kernel policy. Missing required capabilities should fail
configuration visibly; do not fabricate a renderer or silently change modes.

The precise context names, provider-to-context assembly and generated source diff
are still a review gate. These illustrative API/web types are not accepted public
exports or a reason to split otherwise cohesive runtime owners.

## Manifest and guarded-view seam

Keep the earlier proposed format/build identity/selected-output manifest and
`createPublicArtifactResolver(unknown, { origin, releasePrefix })` sketch. Policy
owns one canonical HTTPS origin; artifact entries own relative paths, MIME, bytes
and digests. Do not add arbitrary entry URLs, private source maps, request-time
uploads, global mutable manifests or a generic storage publisher.

The boundary must validate the unknown input, copy/freeze accepted data and use
own-key lookup. Detect duplicate logical names/destinations in the collector
before JSON serialization can erase them. Retain the earlier containment and
percent/query/fragment restrictions until a reviewed change. Type strings and a
`sha256-` prefix cannot prove a safe URL, digest length, output-byte match or trusted
build. The compile probe deliberately shows that invalid input still reaches this
required runtime validation boundary.

An app-owned guarded view can explicitly receive resolved asset metadata and author
its tags. Do not rewrite native-built HTML or automatically inject globals into
every view. The existing browser controls prove entry SRI/CORS and one bounded
import-map mechanism, not a complete graph, provider or migration contract. Document
ownership and error handling for missing assets/build mismatch must be accepted
before a helper or generated template is implemented.
Configuration failures should stop startup, while a missing dynamically resolved
logical name should follow the existing request error boundary. Never fall back
to an unvalidated URL or remote request. The existing template engine should escape
explicitly supplied metadata; this sketch does not introduce a raw HTML builder.

## Confirmed defects are not guarantees

M0's dated compatibility receipts never asserted a bug-free baseline. The current
review independently reproduced a [native parameter double-decode defect](NATIVE-ROUTE-PARAMETERS.md)
on published 2.2.52: a valid percent sign throws and an encoded-looking identifier
changes before model lookup. That correction belongs on the compatibility line;
the major proposal reuses Bun's already-decoded values. Do not preserve the defect
or introduce a new parser as part of route typing.

The nine starter-composition defects corrected in 2.2.52 remain separate confirmed
findings. External dynamic/protected consumers, whole asset graphs, provider TLS,
cookie scope, cached clients and mixed-server lifetimes remain uncertainties. A
compiler success does not promote any of those to a guarantee.

## Migration, deprecation and rollback gates

Before implementation, inventory each app's route aliases/methods/opaque values,
WebSocket fallback, concrete provider capabilities, document source and configured
hooks. Preserve the source/lock/config/runtime/build snapshot and all established
published profiles. Produce a reviewable per-app compile and runtime diff. Package
installation must not regenerate customized source or publish old private files.

Keep the 2.x imports/behavior available during the agreed bridge. No deprecation
date, support window, major version number or channel promotion is selected here.
Require explicit acceptance before introducing the new exports, startup failures
or generated-code migration. Rollback restores exact source/config/lock/runtime
and retained immutable builds, preserving committed data/effects and old cached
clients. Never remove prior artifacts until the selected retention policy permits
it; no destructive schema reversal or blind effect replay is implied.

Next gates are a reviewed runtime validation/error policy, whole module/asset graph
and supported-browser qualification, a selected provider with HTTPS/cookie/CSP/CORS
and publication/retention ownership, then old/new cached-client migration and
rollback. Native asynchronous-pipeline truncation and mixed-server abort reporting
remain unresolved. Shop adoption stays manually held for #257; the timer stays off.

## Reproduce and inspect the bounds

Run the opt-in compiler probe with the repository's installed TypeScript and a new
owned receipt directory:

```sh
bun scripts/characterize-http-contracts.ts /tmp/strata-http-contracts-new-run
```

It writes independent consumers into its new owned receipt directory and compiles
them with the installed native TypeScript CLI against real SDK/framework types,
requires exact diagnostic codes for negative cases, rejects unrelated diagnostics
and retains every source/diagnostic plus input hashes. It does not execute a route
factory or change application packages, runtime behavior, databases or the shop.
Known-type-limit cases are dated observations for review, not requirements to keep
an unsound acceptance if the compiler improves. The new compile cases are separate
from the 159 published framework profiles and twelve compatible rollback profiles.

The [dated compiler receipt](qualification/m1-http-contracts-2026-10-23.json)
records **43 executed, 43 expected outcomes, zero misses/skips** on TypeScript
7.0.2 and Bun types 1.4.3: thirteen proposed positive controls, twenty-three
rejections, six known type-limit acceptances and one retained current WebSocket
fallback contract. The six limitations are explicitly not guarantees. A separate
negative harness control replaced the rejected BunFile expression with a valid
Response while retaining the expected error; the probe failed exactly that case.
Every original fixture byte was then restored and the complete probe passed.

The first fixture attempt assumed the pre-7 compiler API and failed on the
installed TypeScript 7.0.2 package. Its log is retained. The probe now uses the
existing CLI and inherited compiler options, with no dependency or compiler
substitution. A subsequent receipt retained three diagnostic-code mismatches
(`2353` excess-property errors, not `2322` assignment errors) and the native CLI's
nonzero exit convention. These are tooling corrections, not framework defects or
relaxed negative cases.

Primary references: [Bun native routing](https://bun.sh/docs/runtime/http/routing),
[TypeScript structural compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)
and [excess-property checks](https://www.typescriptlang.org/docs/handbook/2/objects.html#excess-property-checks),
plus the [TypeScript 7 API transition](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
The pinned local compiler receipts establish the observations; online documentation
alone is not version-specific execution evidence.
