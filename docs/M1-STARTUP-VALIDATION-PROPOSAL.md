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
   actual methods the adapter will register. Compare the reviewed matching-shape
   and effective-method identities while retaining each original owner. Static Response, callback shorthand,
   explicit HEAD/OPTIONS and synthesized preflight occupy different semantic slots;
   do not infer equivalence merely because their TypeScript values are assignable.
5. Reject a recognized matching shape claimed by two intact declarations
   before any route-registry mutation or listener opens. Return both owners,
   original paths, effective methods and matching shape. Disjoint methods from
   different owners at the same path need a separate decision too: combining them would
   introduce method merging where 2.x replaces the whole path. The proposed
   default is one declaration owner per recognized matching shape; diagnose multiple
   owners even when methods are disjoint, until a composition policy is accepted.
   An app can deliberately supply one cohesive method map with its own complete
   metadata. No automatic merge, replacement or override flag is selected here.
6. Install one reviewed route/metadata snapshot and open the existing server only
   after all checks pass. If provider initialization already acquired resources,
   use the existing reverse cleanup/lifecycle owner on rejection. Do not create a
   second router/container or leave partial global registry state.
   Record failed/blocked cleanup explicitly: a failed drain retains the existing
   infrastructure guard and cannot be turned into an automatic retry certificate.

The new failed/repeated collection observations below expose current registry effects.
Staged snapshot installation and rollback still need lifecycle characterization
before implementation. This proposal does not claim a transaction around arbitrary
user module side effects. Capture rollback responsibilities explicitly rather than calling
module callbacks twice to simulate validation.

## Canonicalization and overlap limits

The pinned native/framework path and method observations below now bound the proposal.
Use absolute keys, exact seven native HTTP method names and explicit prefix ownership
for review; keep current aliases/lowercase normalization on the 2.x bridge. A finite
proposed grammar and matching-shape comparison replace an assumed URL-parser
canonicalization. Neither this proposal nor the probes implement that validator.
Meaningful literal/parameter/wildcard specificity can coexist and is not automatically
a collision. Pattern forms outside the qualified subset require an explicit decision,
not a second universal router or an untested overlap claim.

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
Add tests for each proposed startup failure with no published listener or partially registered
routes, no handler execution and complete owned cleanup. These are required future
validator tests; the present constructor observations alone do not prove them. Assert actual source-owner
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
static/parameter/wildcard precedence and automatic parameter decoding. The dated
pinned-SDK receipts below establish only their specific executions. The
[HTML import-map standard](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps)
does not replace browser qualification. Existing repository receipts document the
separate bounded 43 compiler, ten browser and static-engine results. No new browser,
provider or breaking-implementation acceptance is claimed here.

## Pinned path, method and collision feasibility

This continuation uses official native Bun 1.4.3 and an independently generated
application with exact published 2.2.53 packages. It does not implement a proposed
factory, validator, registry snapshot or breaking API. Native and framework
requests use real loopback sockets, isolated child processes and the Node HTTP
client's explicit request-target string. The receipt records that sent target,
the native request URL and its separately parsed URL pathname; these are different
observations, not interchangeable routing identities.

The dated [receipt](qualification/m1-route-patterns-2026-10-24.json) records
**44 definitions and 82 isolated executions: 18 contract controls, 62 feasibility observations and two dated confirmed-defect reproductions; zero failures or skips**. Contract controls, open feasibility observations and confirmed
defect reproductions are separate categories. A completed observation does not
make the observed behavior desirable or a guarantee to preserve. The original
2.2.53 native-route and collision consumers run unchanged first, using their exact
versioned Git blobs and hashes. The earlier 43 compiler cases and 159/12 published
qualification records remain separate, unchanged evidence.

### Declaration identity is not URL normalization

The known specificity controls select exact, parameter, wildcard and catch-all
handlers in the same order even when declaration insertion order reverses.
Literal routes differing only in letter case remain distinct. `/trail` and
`/trail/` are distinct in this SDK; a wildcard `/files/*` matches `/files/` and a
nonempty tail, while `/files` follows the fixture fallback. Do not trim a trailing
slash, merge a wildcard root or redirect implicitly as a validation shortcut.

Raw `/a/../b`, `/a/%2e%2e/b` and backslash request targets can select their literal
declarations while a parsed URL pathname looks like another route's path. The
native control exhibits the same result. Query-bearing declaration keys can start
but ordinary query requests dispatch to the query-free route. The fragment probe
uses an adversarial raw target; it does not qualify browser navigation or valid
HTTP fragment semantics. Empty and middle-wildcard keys can start without matching
the tested requests. Accepted construction is not proof of a useful route grammar.

Unescaped non-ASCII declarations are rejected at native startup. A separately
registered `/caf%C3%A9` works, while the lower-case escape spelling in the bounded
request takes the fallback. Percent-bearing literals remain byte-distinct. Neither
case folding percent escapes nor decoding a declaration is a proven safe way to
merge native routing identities. Native parameter values are already decoded; the
2.2.53 percent-value controls remain intact and no validator should decode them again.

For review, the first finite declaration grammar should require an absolute,
nonempty ASCII declaration, named parameters with unique names, and at most one
terminal wildcard. Reject query/fragment syntax, backslash, empty interior segments
and dot segments with a useful declaration diagnostic. Keep a terminal slash
significant. This is a proposed stricter major grammar, not a 2.x patch or proof
that every other SDK pattern is unsupported. Encoded literal paths need a clearly
bounded, SDK-qualified spelling policy; do not silently normalize them or promise
arbitrary Unicode/escape equivalence. Migrate an affected legacy declaration with
an explicit per-app diff, retaining the 2.x bridge until reviewed.

### Effective methods must include fallback and synthesis

The raw native bare callback handles all tested HTTP methods. The 2.x framework
bare callback registers GET, inherits native HEAD behavior and synthesizes OPTIONS;
other tested writes follow the fixture fallback. A direct Response covers the six
existing non-OPTIONS methods in the framework, with a synthesized 204 OPTIONS;
the native static Response instead answers OPTIONS with its own response.
An explicit method-map HEAD or OPTIONS wins over the corresponding implicit case.
POST-only maps do not acquire GET or HEAD handlers.

All recorded wire HEAD callback executions and framework admission observations
report HEAD and empty response bodies, including GET fallback, the controlled
unrelated explicit-HEAD case and literal/parameter specificity. An early provisional
handoff inference that these receipts showed GET was incorrect; no such method
change is supported by the raw results. Do not invent a transport defect from that
inference. This remains a bounded SDK observation rather than a cross-version
completion or wire-protocol guarantee. Explicit HEAD handlers are separately
qualified; adding them automatically needs its own policy and consumer proof.

Native lower-case-only method maps reject startup. With an upper-case GET present,
the extra lower-case spelling is ignored by the native control. The framework
normalizes both and the last normalized entry wins. The proposed new contract
therefore rejects any non-SDK own method key instead of relying on SDK excess-key
behavior. Keep existing 2.x normalization during the bridge.

The collector's validation plan must expand the actual framework registration:
explicit methods, potential GET-to-HEAD fallback and synthesized OPTIONS, with an
explicit-over-implicit rule inside one cohesive declaration. This is a proposal,
not new dispatch code. The preflight observations establish dispatch/status and
handler non-execution, not provider/CORS/credential qualification.

### A matching shape needs its own collision decision

`/dupe/:id` and `/dupe/:slug` share a matching shape. When both define GET, the last
native declaration wins; reversing order reverses the winner and the parameter
name delivered to the callback. With GET on one and POST on the other, both work
and each receives its own parameter name. An explicit HEAD and a GET fallback can
also occupy the same matching shape. These results invalidate a collision check
that compares only literal declaration strings or only explicit method keys.

For the proposed limited grammar, compare a declaration's matching shape while
retaining original parameter names and full source ownership for diagnostics.
This is declaration validation, not permission to build another request router.
Do not rewrite native paths or merge handlers under a renamed parameter: a callback
expecting `slug` would otherwise silently receive a map keyed by `id`.

The proposed default remains one intact owner per recognized matching shape, even
when owners declare disjoint methods. That stricter default requires acceptance
and a migration; current native dispatch demonstrably permits such compositions.
An app can deliberately produce one cohesive method map and metadata under one
owner. Ordinary literal/parameter/wildcard specificity is a different relationship
and must not be rejected merely because request sets intersect. Unsupported or
unqualified grammar needs an explicit decision before implementation, not an
unvalidated universal overlap detector or a generic override flag.

### Capture before lossy composition; stage before registry mutation

The module controls preserve whole-path replacement, raw-key insertion/alias
precedence, actual handler/OpenAPI ownership and pre-composition provenance loss.
A later raw assignment does not move an existing JavaScript key's position, so
module order alone is not the canonical winner rule. The existing compatibility
assertions remain; this characterization does not prove an app intended that winner.

The failed-rebuild observation first registers a valid route, then rejects an
orphan OpenAPI declaration. The prior registry is already cleared when the error
returns. Repeating collection with `clearRegistry: false` can append duplicate
registry entries. Thus current 2.x collection is not an atomic candidate-snapshot
transaction. No handler ran during these probes, but a constructor rejection alone
does not prove there was never a transient native bind or arbitrary module side effect.

Refine the proposed sequence to capture intact declarations, validate their shape,
capabilities and effective collisions, and construct candidate route/metadata data
before calling the current global registry's `clear`/`register` methods. Installing
an accepted snapshot, restoring it on later startup failure and associating it with
the actual application owner require concrete lifecycle tests. This is a proposed
major boundary, not a source registry redesign or M2 isolation acceptance. Do not
call a module factory twice or promise rollback of arbitrary application code.

### Confirmed defect: own parameter keys

The `__proto__` probe found a real published 2.2.53 defect, separate from native
matching policy. Bun supplies an own string value; `routeParams` assigns onto `{}`
and loses the key through its inherited legacy setter. The `constructor` control
retains its value. These string-value observations establish parameter loss, not
prototype pollution. The proposed grammar must not simply ban the key to hide a
compatible helper defect.

A new real-native regression fails on original source and exact published 2.2.53
before a compatible own-data-property correction. The correction in [PR #354](https://github.com/EyK-26/strata/pull/354) (`c07cd2faa474bd15471e8b547bd9e68693ba296e`)
retains the ordinary object prototype, coercion, request identity, repeated
adaptation and all original assertion bodies. It was a source-only correction at the time of this pinned probe, and published
2.2.53 remains immutable. A separate qualified 2.2.54 release now publishes it; see
the [parameter audit](NATIVE-ROUTE-PARAMETERS.md) for actual release/159/12 gates. The pinned 2.2.53 probe intentionally retains
this dated defect reproduction; it is not a required behavior of a future candidate.

### Before a breaking implementation

Accept the finite declaration grammar, matching-shape ownership rule and method
expansion policy with per-app source/metadata diffs. Confirm exact diagnostic data
and exports; stage registry changes without losing original/cleanup failures.
Require real negative startup controls, request-time error tests and original
consumer preservation before introducing an implementation. A deliberate wrong-owner
negative control must fail the probe while retaining its real observed response;
then the unchanged normal inputs must complete again.

The explicit public artifact origin remains the selected major design target.
Whole module/asset graphs, supported browsers, selected provider HTTPS/cookie/CSP/
CORS/publication/retention and old/new cached-client migration/deprecation/rollback
remain separate gates. The native pipeline and mixed HTTP/WebSocket completion
limitations remain unresolved. Shop adoption remains held for #257; timer stays off.


## Diagnostic and startup-publication proposal for review

This advances the design after the path/method/collision observations. It does not
implement a validator, exported error type, registry transaction or public asset
provider. No proposed diagnostic below is an existing 2.x exception contract.
Accept the precise fields and phase rules before adding a breaking implementation.

### One diagnostic record, existing error ownership

Use one plain diagnostic record through the existing bootstrap failure boundary;
introduce an exception hierarchy only if a real consumer needs it. Proposed data:

- `reason`: a stable discriminant, proposed below; useful human text is additional,
  not something a caller must parse to distinguish failure classes.
- `phase`: declaration, capability, artifact or publication. Request-time failures
  are reported through the existing HTTP boundary rather than being mislabeled as
  startup errors.
- `owners`: all observable declaration owners, each with module identity, original
  declared path and declared methods. A source file/line is optional, supplied by
  its owner; never infer it from an unrelated stack or invent erased provenance.
- `field`: the failing declaration/configuration field. Include effective methods
  and a recognized matching shape only when the reviewed grammar establishes them.
  These are diagnostic data, not a replacement native request router.
- `buildId` and logical artifact identity only for relevant artifact failures;
  never construct an unsafe fallback URL or expose a private storage path.

Proposed declaration reasons are `invalid-route-value`, `invalid-route-method`,
`invalid-route-path` and `route-owner-conflict`. Capability and artifact reasons are
`missing-document-capability`, `invalid-artifact-manifest` and
`artifact-build-mismatch`. These names and their exact payload/export shapes are
review proposals, not accepted public API names or exhaustive SDK failure types.
An unsupported grammar form must not masquerade as a proven overlap or a syntax
error from Bun. Preserve a later native constructor rejection as its original cause
through the transport/bootstrap boundary instead of reclassifying every exception
as a declaration error.

The original cause and all cleanup failures remain available to the existing
internal error owner. Render safe owner/field information without request bodies,
cookies, credentials, private manifest values or automatically emitted stack traces.
A serializable record does not imply that every cause can safely be serialized.
Do not change the existing 2.x logged-error or exception behavior just to expose
this proposed new diagnostic shape.

### Candidate state before publication

The design has five observable phases, with the existing application lifecycle as
owner: collect intact declarations, validate configuration/capabilities, construct a
candidate native route/metadata snapshot, publish the accepted snapshot/listener,
and retire resources through reverse cleanup. There is no second container/router.

Collection invokes each module factory once. A module can already have arbitrary
side effects; this proposal cannot make them transactional. Track owned disposable
resources through existing lifecycle facilities. Static validation inspects own
property descriptors without executing accessor values or business handlers. The
accepted route grammar and method/owner rules determine whether a candidate is
valid; the 2.x overwrite order is migration input, not validation success.
Descriptor inspection avoids invoking ordinary getter values, but a Proxy can
still execute user-supplied traps or throw. Do not advertise inspection of arbitrary
JavaScript objects as effect-free, swallow those errors or call a module factory
again to hide them. Preserve the original cause through the bootstrap owner and
exercise owned cleanup separately.

Do not clear/register the global route registry while still checking declarations.
Keep candidate route/metadata data local until validation has succeeded. Defining
how to install and restore an accepted snapshot belongs to the existing single
active application/lifecycle boundary. Do not claim simultaneous-runtime isolation,
change M2 ownership or roll back arbitrary module effects as part of this proposal.
This is a startup/candidate-state boundary, not a new live-reload feature. Initial
startup and failed-then-corrected fixture attempts must have explicit registry
baselines; retaining a prior baseline does not promise concurrent running apps or
zero-downtime replacement.

A native constructor can still fail after static validation. That failure must
retain the original cause and trigger owned cleanup. Distinguish “no published
listener” from “no transient socket bind”: the current constructor observations do
not measure every bind or cleanup edge. Prove any stronger guarantee with an actual
listener/resource observer before advertising it. Do not instantiate another server
or invoke module factories twice merely to test validation.

### Required negative and retry evidence

Before implementation is accepted, a concrete candidate must prove each of these:

- Invalid own route values, method keys, accessors or a rejected path produce the
  relevant owner/field diagnostic, execute no business handler, publish no listener
  and leave previously accepted registry data unchanged.
- Conflicting intact declarations report both real owners and reviewed effective
  methods/matching shape. An earlier JavaScript overwrite is reported as outside
  the received inventory, not reconstructed as a fictitious second owner.
- Missing renderer capability or an invalid/mismatched artifact manifest fails
  before accepted state is published. A valid guarded file Response remains valid;
  an opaque native asset must not silently bypass admission.
- A native constructor failure after validation releases only the candidate's
  owned resources. Keep the prior accepted state where the lifecycle contract
  requires it; do not delete another application's state or claim multi-app support.
- When cleanup itself fails, the original startup failure remains inspectable and
  the cleanup failures are retained. A failed cleanup is not recorded as success.
- A corrected retry invokes each module once for that attempt, publishes one
  coherent handler/middleware/OpenAPI owner snapshot, and creates no duplicate
  registry entries. Stop/restart and failed-then-successful attempts need real
  sockets and resource baselines, not a pure-map simulation alone.

Late callback output and dynamic logical-name errors remain separate request-time
cases. Their exact public status/error policy still needs acceptance; no static
function type can prove a future callback's return value. Require a sanitized
unsuccessful outcome, existing HEAD/body handling and no alternate-route, asset or
WebSocket-success fallback. Preserve the current concrete error/transport contracts
until a reviewed major change is selected.

### Migration and rollback consequences

Each new rejection needs an app-owned inventory diff: original owner/path/methods,
actual 2.x winning handler/metadata, proposed diagnostic and a reviewed replacement.
Disjoint native method maps and meaningful specificity remain evidence to consider
before accepting a stricter one-owner rule. Do not silently combine their metadata,
ban an otherwise supported parameter name to hide a compatible defect, normalize
away distinct native literals or regenerate customized source during installation.

Keep the agreed 2.x bridge until exact APIs, deprecation/support windows and per-app
acceptance are selected. Major promotion still needs actual source/config/lock/
runtime/build snapshots, old/new cached clients, retained immutable public artifacts
and committed-data/effect preservation under rollback. The compatible twelve-profile
2.2.53→2.2.54→2.2.53 rehearsal does not establish those major guarantees.

The selected explicit public artifact origin, whole-graph/browser/provider security
and retention gates remain unchanged. Native asynchronous-pipeline truncation and
mixed HTTP/WebSocket completion ambiguity remain unresolved. Breaking implementation
stays paused; shop adoption remains manually held for #257; timer stays off.

## Startup, cleanup and retry feasibility on published 2.2.54

The [dated receipt](qualification/m1-startup-2026-10-24.json) records **16 isolated
executions: five compatibility controls, ten feasibility observations and one
confirmed-defect reproduction**, with zero harness failures/skips. A freshly
generated SQLite/API app uses exact published 2.2.54 and native Bun 1.4.3. Its
unchanged versioned native-route/collision consumers, migration and original
strict typecheck pass before the new probe module is installed and typechecked.
No Bun server, framework package or native driver is replaced or patched.

The fixture is an ordinary module/provider extension. It acquires real owned
loopback listeners, injects deliberate register/boot/declaration/cleanup failures,
and exercises the generated bootstrap and actual server entrypoint. Native bind
rejection leaves the separately owned occupier healthy. Closed resources can be
rebound; resources intentionally left open after failed drain remain reachable
before fixture-only recovery. These observations do not prove every transient
socket bind, arbitrary module effect, database/worker failure or platform behavior.

A separate wrong expected factory count fails the real `1 !== 99` assertion after
all five baseline steps pass, then releases the owned fixture. The unchanged normal
16 cases complete again afterward. The earlier 82 transport, 43 compiler and
159/12 release/rollback records remain separate, byte-identical evidence.

### Separate readiness, registry state and listener ownership

Ordinary register/boot/dependency failures unwind registered resources in reverse
order and retain the original error. A cleanup callback may close its resource and
still reject; the failure must remain visible even when the socket was released.
Flush failures are aggregated while close callbacks continue. These observations
support existing lifecycle ownership, not a new transaction over arbitrary code.

Route factories, getters and Proxy traps can throw after providers are ready.
Their original marker errors survive generated bootstrap cleanup. The previous
registry snapshot can already have been cleared by the collector. Native route
construction can instead fail after bootstrap returns a ready context and has
registered metadata. The public server factory alone does not own that caller's
context: a caller must use its existing lifecycle owner to dispose it. The actual
generated entrypoint has that ownership and performs cleanup on a bind failure.

Source ordering also matters: `createAppContext` publishes the active context
before generated `buildRoutes` runs. A listener not being published does not mean
that context or route metadata was never published. A new route validator cannot
obtain atomic application startup merely by wrapping the present collector and
clearing the registry after an exception. That would lose ownership and expose
partial state. Preparing local route/metadata data, publishing it and retiring it
need an accepted lifecycle seam; moving active-context readiness also needs M2
compatibility analysis. No unpublished-context constructor, registry rollback
implementation or multi-runtime model is selected here.

### Retry is conditional on cleanup disposition

Twelve deliberate startup/construction failures support a corrected retry, and
two ordinary/late-request controls support a sequential restart. In each of those
fourteen controlled cases, the next attempt invokes the probe factory once,
registers one matching handler/OpenAPI owner, serves the expected real HTTP body,
and disposes its resources once even under concurrent disposal calls. This is a
single-app, isolated-child observation, not live replacement or simultaneous apps.

The two failed-drain cases deliberately **do not retry**. The existing compatibility
test requires infrastructure to stay open rather than close beneath admitted work.
The successful-context drain case remains active; the failed-startup drain case has
no published ready context but still owns open resources. Context absence alone is
therefore not a safe-retry certificate. The fixture stops only its own listeners
at the end and explicitly reports this as harness recovery, not framework cleanup.
It neither overrides the drain result nor silently restarts the application.

Refine the proposed diagnostic envelope to distinguish an observed complete
cleanup, a reported cleanup failure and cleanup blocked on drain. Preserve the
original cause plus every cleanup failure. Do not infer safe retry from an error
name, an empty registry or a missing active-context pointer. A caller may correct
configuration and start a new attempt only after the existing lifecycle owner has
resolved resource/work ownership. No automatic startup retry loop or new forced
close policy is accepted. Live admitted SQL/work during failed startup drain and
actual database-close failure remain separate qualification gates.

### Compatible defect found at the generated entrypoint

Published 2.2.54 loses the original native `EADDRINUSE` error if provider close also
rejects: the generated server's `try/finally` cleanup throws the provider aggregate
instead. The ordinary bind-failure control retains the native error, and the
bootstrap register/boot cleanup paths already aggregate both causes. This is a
confirmed error-retention defect, not a compatibility behavior to preserve.

The new mandatory real generated-entrypoint regression fails on unchanged source
at the missing native cause. The compatible correction uses the existing bootstrap
aggregation pattern: attempt each owned cleanup, retain the native failure as
`cause`, and include cleanup failures. The same regression then passes, including
the original native-error identity, the provider-close failure, resource release
and a corrected retry. Original lifecycle tests and their failed-drain guard remain
byte-identical. The correction is **source-only**; no new version/tag or publication
is prepared in this design continuation. Published 2.2.54 remains immutable.

The historical rendering manifests and their assertions remain unchanged. The
existing reviewed-delta gate records only this literal server cleanup correction,
checks the exact corrected hash, reverses it to the historical bytes and verifies
the forward round trip for all eight scaffold profiles. The initial full gate
correctly rejected those eight changed artifacts before this delta was declared;
that failed run is retained separately from the subsequent validation.

### Refined API review gates

Keep the proposed diagnostic record under the existing bootstrap boundary, with
observable owners/field/phase and optional build identity. Add cleanup disposition
and caller-owned retry responsibility to that review; do not introduce an exception
hierarchy or promise serializable arbitrary causes. The compatible aggregation fix
introduces no proposed diagnostic export, new validator or route API.

Require separate evidence for declaration/capability rejection, candidate metadata
publication, native construction failure, caller cleanup and late request errors.
The late-handler control starts successfully and then returns an unsuccessful HTTP
response; it is not a startup rejection and must not trigger a route/asset fallback.
Preserve bounded native error causes rather than labeling every SDK exception an
invalid declaration. Keep getter/Proxy effects, prior JavaScript overwrites and
module side effects outside any invented purity or rollback guarantee.

Before a breaking implementation, accept precise grammar/method/owner/error/API
shapes, stage route/metadata data without mutating accepted state, qualify resource
and cleanup failures with real admitted work, and exercise corrected retries under
that accepted ownership policy. The explicit public artifact origin, complete asset
graphs, supported browsers, provider TLS/cookie/CSP/CORS/publication/retention and
major migration/deprecation/cached-client rollback remain independent gates. Native
pipeline truncation and mixed HTTP/WebSocket completion ambiguity remain unresolved.
Shop adoption stays manually held for #257; timer stays off.

## Separate qualified 2.2.55 publication

The error-retention correction above was source-only at the dated feasibility
checkpoint. A separate authorized 2.2.55 release now publishes it after actual-main
CI/security, actual-main npm readiness and the full trusted workflow pass. All 159
retained published profiles and twelve 2.2.54→2.2.55→2.2.54 rollback profiles pass; sixteen
published startup executions retain the controls and assert the corrected cause.
The original published 2.2.54 defect receipt remains immutable historical evidence.
See the [startup audit](STARTUP-CLEANUP-ERRORS.md) for actual gates and limits.

A fresh customized-app rehearsal separates dependency installation from deliberate
generated-source adoption. Adopting the published 2.2.55 catch preserves the original
cause with 2.2.54/2.2.55 dependencies and exact 2.2.54 dependency rollback; reversing the source
patch deliberately restores the known 2.2.54 defect. Existing apps require their own
reviewed adoption and validation; no package install may overwrite their source.
This compatible evidence accepts no major route/asset API or migration guarantee.

## Follow-on M1 review: cleanup results are not retry authorization

This is a design continuation after the compatible patch qualification. It adds no
validator, exported diagnostic, registry transaction, public artifact provider or
breaking runtime behavior. The exact field names, exports and ownership boundary still
require acceptance before implementation.

### Keep three independent observations

The measured lifecycle cases need three facts rather than a single `retryable`
flag or a success/failure label:

- **Primary failure:** retain the original declaration/provider/native failure at
  its existing owner. A later cleanup rejection must not replace it. An unclassified
  SDK exception remains an original cause, not a fabricated invalid-declaration
  diagnostic. Preserve cause identity internally; do not serialize arbitrary errors.
- **Cleanup outcome:** record whether cleanup reported failures and which lifecycle
  phase blocked progress. A callback can release its socket and then throw; its
  reported failure remains significant even when that particular resource is gone.
- **Owned-resource disposition:** distinguish observed release, explicitly retained
  ownership and unresolved ownership. State the scope of the owner's evidence;
  this cannot certify rollback of arbitrary module/import effects or all resources
  reachable from application code.

The earlier complete/failed/drain-blocked vocabulary describes cleanup outcomes.
It must not collapse resource disposition into the same state field. Proposed
cleanup details can extend the existing diagnostic record, with observable
phase/owner and bounded failure counts. Exact names are review targets; there is
no new exception hierarchy or serializable native-error contract. Safe diagnostics
must not expose private paths, credentials, payloads or automatic error stacks.

### Apply the observations to the measured boundaries

A normal startup rejection with completed owned cleanup supports a separately
corrected attempt after its caller resolves configuration. The generated entrypoint
owns its context cleanup after a native bind rejection; the raw server factory's
caller owns the context it supplied. Error code, missing active context and absence
of a published listener are insufficient evidence that resource ownership ended.

A close callback that throws after closing its owned listener must retain both the
original startup cause and the cleanup rejection. The fixture can independently
observe released sockets; a general API cannot infer that disposition from the
exception alone. Conversely, failed drain deliberately retains infrastructure.
It blocks flush/close even if no ready context was published. Do not turn that
result into a forced close, shortened lease or automatic restart. Repeating a
memoized disposal call is not a recovery policy.

A late handler failure belongs to the request boundary after successful startup.
It does not authorize recollection, listener replacement, another asset route or
WebSocket-success fallback. Keep that case separate from startup diagnostics.

### Candidate state and lifecycle ownership still need an accepted boundary

Static declaration/capability validation, factory evaluation, native construction,
metadata publication and listener ownership are distinct phases. Factories can
require ready providers, and current 2.x publishes its active context before route
collection. Descriptor checks do not make arbitrary Proxy traps or module effects
pure. The proposed collector can stage local metadata, but it cannot manufacture an
unpublished context or atomic application replacement through the existing API.

Before implementation, select the M2-compatible lifecycle owner and the point at
which a candidate becomes accepted. Characterize invalid-candidate failure before
registry mutation, later native construction failure, reverse cleanup failure and
corrected retry under that policy. Include a previously accepted registry baseline
without promising simultaneous running applications or zero-downtime replacement.
Do not bind a second listener or call factories twice just to validate a candidate.

### Next evidence and migration gates

Qualify real admitted SQL/work during failed drain, actual database-close failures,
worker/import effects and platform-specific bind/release behavior. Record reported
cleanup errors separately from observed resource release, preserving the existing
leave-infrastructure-open assertions. No automatic retry certificate is accepted.

The explicit public artifact origin remains the selected major design target.
Exact route/method/owner/diagnostic/export acceptance, whole asset graphs, supported
browser/provider TLS/cookie/CSP/CORS/publication/retention, major per-app migration,
deprecation/support windows and old/new cached-client rollback remain open. Native
pipeline truncation and mixed HTTP/WebSocket completion ambiguity remain unresolved.
Shop adoption stays manually held for #257; timer stays off.
