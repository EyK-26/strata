# M1 startup validation and declaration ownership proposal

Status: design continuation, not an accepted breaking contract. No runtime validator,
new export, route collector, manifest resolver, provider or generated source is
implemented here. Use the earlier M1 guarded HTTP declaration fixture and its 43
compiler observations; retain all frozen M0/M1/M2 files. This proposal advances the
explicit public artifact-origin target and records the remaining implementation gates.

## Evidence and boundary

Native route parameter decoding belongs to Bun. The compatible correction in #350
removes a second decode. The separate [published 2.2.53 audit](NATIVE-ROUTE-PARAMETERS.md)
records all 159 profiles and twelve compatible rollback profiles passing; those
results do not implement or qualify the proposed major API. Do not use a path
validator or collision detector to decode request parameters again. Keep the
request object, lookup key and authorization owner intact.

Current 2.x composition collects raw maps using `Object.assign`, then prefixes
aliases. Reassigning an existing raw key replaces its whole method map without
moving its insertion position. Canonical alias collisions then follow those raw-key
positions: the last module is not necessarily the final canonical-path owner.
For example, modules returning `/shared` GET, then `shared` POST, then `/shared`
GET leave the prefixed path with the second module's POST. The existing
`buildModuleRoutes.test.ts` insertion-precedence assertion records this behavior.
Methods are not merged, and handler, middleware and OpenAPI metadata must travel
together with the actual winner. New-major diagnostics must capture intact
module declarations before this lossy composition. No 2.x precedence change is
implemented or selected merely by describing the current behavior here.

The existing defineApplicationRoutes declaration fixture is a finite type sketch,
not a sealed-object guarantee. A named method object can carry extra keys, optional
methods can be explicitly undefined, template paths can contain queries, and
object spreads can erase collisions. These are observed limitations, not behavior
that a future validator must preserve. Never claim to detect an overwritten key
that the framework never received.

## Proposed startup sequence

1. Finish the existing provider/module declaration phase without opening the HTTP
   listener. Modules remain the source owners; the existing application container
   and kernel remain the dependency/policy owners. Validate required document
   capability against the actual configured renderer, not the frontend label.
2. Capture each intact declaration together with its module name, original path,
   source location when supplied, method and its own middleware/OpenAPI contract.
   The collector needs this provenance before prefixing or assigning a final map.
   An application that already returns an object spread has supplied only the
   surviving keys; report that inventory scope rather than reconstructing history.
3. Validate actual own keys and values. Do not read inherited route entries, execute
   accessors as a validation shortcut or call handlers to inspect their return type.
   Accept only the reviewed Response/native-callback/nonempty SDK-method-map
   contract. Reject unsupported/undefined methods, extra map keys, arrays and opaque
   native asset values before dispatch. A guarded Response may still contain a file.
4. Apply the reviewed prefix/path policy once, then expand each declaration to the
   actual methods the adapter will register. Compare canonical method/path keys
   while retaining each original owner. Static Response, callback shorthand,
   explicit HEAD/OPTIONS and synthesized preflight occupy different semantic slots;
   do not infer equivalence merely because their TypeScript values are assignable.
5. Reject an exact canonical method/path key claimed by two intact declarations
   before any route-registry mutation or listener opens. Return both owners,
   original paths, method and canonical key. Disjoint methods from different owners
   at the same path need a separate decision too: silently combining them would
   introduce method merging where 2.x replaces the whole path. The proposed
   default is one declaration owner per canonical path; diagnose multiple owners
   even when methods are disjoint, until an explicit composition policy is accepted.
   An app can deliberately supply one cohesive method map with its own complete
   metadata. No automatic merge, replacement or override flag is selected here.
6. Install one reviewed route/metadata snapshot and open the existing server only
   after all checks pass. If provider initialization already acquired resources,
   use the existing reverse cleanup/lifecycle owner on rejection. Do not create a
   second router/container or leave partial global registry state.

This ordering needs a characterization of actual initialization/registry effects
before implementation. It does not claim a transaction around arbitrary user module
side effects. Capture rollback responsibilities explicitly rather than calling
module callbacks twice to simulate validation.

## Canonicalization and overlap limits

Absolute declaration keys, exact seven native HTTP methods and explicit prefix
ownership are proposed for the new API. The compatibility line retains current
aliases/lowercase normalization. Query, fragment, dot-segment, backslash, repeated
slash and percent-bearing declaration policy needs a precise accepted grammar and
native controls. URL normalization is not automatically the grammar for Bun route
patterns; do not run route templates through a URL parser and assume equivalence.

Reject observable exact method/path collisions. Dynamic names with the same route
shape, wildcard intersections, static-versus-parameter precedence and trailing slash
behavior must first be characterized against the selected Bun SDK. Do not implement
a second complete pattern parser or claim all overlap is an exact collision.
A deliberate literal route beside a parameter route can be meaningful; an
unreviewed collision must not silently inherit a security policy from another owner.

There are two distinct acceptance levels: collisions among the intact declarations
the collector received, and all composition including prior JavaScript overwrites.
Only the first is feasible with the current plain-map proposal. The second needs
an explicitly accepted provenance-preserving declaration/composition surface; it
is not a guarantee obtained by adding a branded type or freezing the final map.
No additional public collection API is selected in this document.

## Error ownership proposal

Startup errors should identify the module/build and declaration field using stable
machine-readable reason codes plus useful human text. Proposed reasons are invalid
route shape/method/path, intact-declaration collision, missing document capability,
invalid manifest/policy and artifact/build mismatch. Exact exported error names and
payload fields remain a review gate; a new exception hierarchy is unnecessary
unless an actual consumer needs one.

Do not log manifest secrets, response bodies, cookies or credentials. Include both
source owners in collision diagnostics; include the logical artifact/build identity
in configuration errors. Diagnostics must not contain an automatically constructed
unsafe fallback URL. Emit failure before listener publication, retain existing
cleanup errors and the original cause, and exit unsuccessfully through the existing
bootstrap error boundary.

A callback that returns an invalid value can only be detected after invocation;
its valid function type does not prove runtime output. Route that failure through
the existing HTTP error/observation boundary with a sanitized unsuccessful response.
Do not reinterpret it as an asset, a successful empty response, WebSocket success or
another route. HEAD still suppresses response bodies. Callback-return policy is a
separate major behavior decision, not something to alter in this patch release.

Unknown dynamic logical asset names belong to the caller/request error boundary.
Known configured template assets and mismatched build identities must fail startup.
Never fetch a missing asset, fall back to an arbitrary public URL or retry a different
build automatically. Missing asset errors are not authorization decisions.

## Manifest snapshot and publication boundary

The proposed resolver consumes unknown build metadata plus one origin/prefix policy;
validation copies/finalizes an app-owned immutable snapshot using own-key lookups.
Keep logical names, relative output paths, MIME, bytes and exact digests associated.
Record duplicate logical names/destinations before JSON serialization; parsing an
already-overwritten object cannot recover them. A digest prefix is not proof of a
valid digest or of matching native output bytes.

Only explicitly selected native public outputs enter the manifest. The builder
must compare bytes/hashes to those actual outputs. The resolver does not walk a
private storage tree, publish files, choose a cloud SDK, mutate global manifests or
receive per-request tenant state. Hashing a private file does not authorize publication.

The selected origin must remain separate from guarded application responses.
Different URL origins alone do not prove cookie isolation when a parent-domain
cookie is possible. A real provider/browser/TLS/cookie policy is still required;
no production domain or retention duration is selected here. Keep application HTML,
authentication, private downloads, ORM and CSRF on the guarded application origin.

## Acceptance before breaking implementation

Retain all current positive/negative/compiler and published consumer assertions.
Add tests for each proposed startup failure with no listener, no partially registered
routes, no handler execution and complete owned cleanup. Assert actual source-owner
messages and unchanged original causes. Add late request failures without an asset
fallback, and real HTTP/native HEAD/OPTIONS controls before choosing method expansion.

Qualify literal/parameter/wildcard/alias composition with handler, middleware and
OpenAPI metadata together. Verify repeated starts and reverse cleanup using existing
lifecycle/DI contracts. A structural type success is not startup, transport or security
acceptance. No universal path overlap or external consumer coverage is claimed.

The separate asset gates remain whole module/asset graphs, supported browsers,
HTTPS/cookie/CSP/CORS, the selected delivery provider and immutable publication.
Entry SRI and the existing bounded import-map controls do not prove integrity of
every dependency or browser. Preserve missing-mapping/tampered-byte negative controls;
no fetch/verify/eval loader or rewritten native output is authorized.

## Migration, deprecation and rollback

Produce an inventory before changing an app: original module/path/method, actual
handler/metadata winner, opaque values, WebSocket fallback, publicDir, provider/view
requirements and any pre-collection composition. Each newly rejected declaration
needs a reviewable source/config diff and an equivalent guarded Response or an
explicitly reviewed public output. Installation must never regenerate customized
source or publish previously private files.

Keep the 2.x imports/behavior available during an agreed bridge. No deprecation date,
support interval, major version or release channel is selected yet. Observe/annotate
mode on the compatibility line would itself need a separately reviewed design;
do not turn a proposal into unsolicited warnings or a runtime dependency.

Before promotion, exercise old and new cached clients, the new application and its
rollback with retained immutable artifacts. Rollback restores exact source/config,
package locks, runtime and build snapshots while preserving committed data/effects.
Revoke accidental public exposure as its own security action; reverting the app
cannot make an already downloaded public file private. Do not delete prior builds
until the accepted retention policy permits it, reverse schema destructively or
replay committed effects. The twelve compatible 52→53→52 profiles are evidence for
that patch migration only, not acceptance of this major migration.

The native asynchronous-pipeline truncation and mixed HTTP/WebSocket abort/drain
ambiguity remain unresolved. The selected public-origin design does not repair them.
Shop adoption stays manually held for #257; the timer stays off.

## References and evidence interpretation

[Bun routing](https://bun.sh/docs/runtime/http/routing) documents native
static/parameter/wildcard precedence; the selected pinned SDK still needs the
proposed overlap/diagnostic controls. The [HTML import-map standard](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps)
does not replace browser qualification. Existing repository receipts document the
actual bounded 43 compiler, ten browser and static-engine results. This proposal
adds no new runtime/browser acceptance count.
