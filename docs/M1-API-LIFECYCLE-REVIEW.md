# M1 API and lifecycle ownership review

Status: proposal and feasibility, 25 October 2026. No breaking implementation,
runtime export, resolver, registry operation or generated-source change is made.
The selected target remains an explicitly public artifact origin. The separate
app is unchanged; shop adoption remains held for #257 and the timer stays off.

This continues the [startup proposal](M1-STARTUP-VALIDATION-PROPOSAL.md) and
[graph proposal](M1-ARTIFACT-GRAPH-PROPOSAL.md). Their historical bytes, all earlier
assertions and the twenty-six frozen plan files are unchanged. Browser follow-up
is recorded separately in the [investigation](M1-BROWSER-INTEGRITY-INVESTIGATION.md).

## Current behavior established with public APIs

Four native Bun tests ran in a fresh consumer with exact registry-installed
`@getstrata/core` and `@getstrata/bootstrap` **2.2.59**. Strict installed-package
typing and all four tests pass, with 29 expectations and no skips. A separate copy
with one deliberately wrong factory-call expectation fails one of the four cases;
the unchanged normal consumer then passes all four again. No package is patched.

The [consumer fixture](../scripts/fixtures/m1-api-lifecycle/consumer.ts) exercises
actual public context, route-registry, module-builder and server APIs with native
loopback sockets. It uses real built-in config/cache/storage/auth/policy providers;
there is no mock auth binding or custom request mechanism. It observes:

- `createAppContext` publishes the provider context before a module route factory
  runs. A rejecting factory runs once, and raw `buildModuleRoutes` has already
  cleared its prior route metadata. The raw builder neither disposes the context
  nor restores the previous registry. These are current ownership observations,
  not guarantees to preserve partial state in the new major design.
- A real occupied-port rejection from raw `createWebServer` leaves the supplied
  context and already collected metadata caller-owned. The previously occupied
  fixture listener remains usable. Raw construction cannot infer the lifetime of
  a caller's provider context.
- A provider close callback can release its socket and then reject. Its original
  error remains inside the aggregate, disposal is memoized, and an independent
  native bind confirms the socket was released. The reported cleanup failure
  remains a failure; resource release does not erase it.
- Failed provider drain retains application services and its owned socket. Close
  is not called, and repeated disposal returns the same rejected operation rather
  than recovering. The fixture stops only its own socket afterwards; this is test
  cleanup, not a proposed production force-close or retry policy.

The initial consumer omitted the real auth/policy providers needed by the HTTP
kernel, causing two fixture setup failures. Adding those actual built-in providers
made the same assertions pass. Those failures and the original input are retained;
they are not evidence of a Strata registration defect.

The unchanged source provider/graceful-shutdown suites also pass: **26 tests,
77 expectations, no failures/skips**, with an owned in-memory SQLite connection,
array cache and sync queue. They do not substitute for live SQL work during failed
drain. See the [sanitized receipt](qualification/m1-api-lifecycle-browser-2026-10-25.json).

## Readiness has three different owners

**Provider readiness** means registrations, boots and dependency validation finished
and the existing application context is available. Current
[`createAppContext`](../src/bootstrap/context.ts) publishes that context itself.
Do not describe a context returned by that API as unpublished, or add another
container merely to make the wording true.

**HTTP preparation** means intact declarations were collected once, capabilities,
paths/methods/collisions and artifact/document references were validated, and route
handlers and metadata form one candidate. Providers can be ready while this fails.
Current [`buildModuleRoutes`](../src/bootstrap/buildModuleRoutes.ts) mutates the
shared metadata registry during construction; it is not this transactional collector.

**HTTP readiness** additionally needs successful native bind and registration with
the existing lifecycle owner. `Bun.serve` opens a listener; do not perform deferred
validation after it and assume requests cannot arrive. A proposed prepared-object
type alone supplies neither an admission gate nor resource rollback.

Retain the accepted single-active-runtime boundary. A copied registry baseline is
not a second live application or a hot replacement protocol. The shared context,
DI tokens, cache, kernel and metadata owner keep their responsibilities and identity.

## Narrow API refinement for review

Retain the earlier manifest/resolver proposal: unknown input is validated and copied
once; logical names resolve through the one approved origin/prefix policy into
immutable URL/media-type/length/digest records. Proposed names are not package
exports. Do not widen guarded routes to opaque assets or let a manifest choose its
own origin. No new property is added to `AppDependencies` by this checkpoint.

The existing renderer needs a document-specific build plan, not an arbitrary list
supplied by a request. An illustrative data shape is:

```ts
// Review sketch only; not implemented or exported.
type DocumentArtifactPlan = Readonly<{
  buildId: string;
  entryScripts: readonly string[];
  windowModules: readonly string[];
  stylesheets: readonly string[];
}>;
```

The build adapter owns this plan and its known dependency evidence. The renderer
owner resolves every name from the same immutable resolver snapshot before rendering
any tag. Entries must belong to the reviewed window-module set; stylesheet names
must resolve to the accepted stylesheet type. Reject a mismatched build, missing
name or incompatible consumer category. A string `buildId` or readonly array is
not runtime proof of any of these facts or of graph completeness.

Prepared renderer data should be immutable records, including the native module
integrity map and tag attributes, rather than pre-rendered raw HTML. Keep the real
app-owned `ViewRenderer`/engine, authentication, CSP and request policy. Public
references do not make the guarded document public. Do not relocate worker entries
or infer their integrity from a document's module list.

Exact renderer/list injection and public function names remain review gates. There
is no second renderer, dependency container, publisher hierarchy or runtime loader.
Native Bun HTML outputs remain unchanged; these references cannot retroactively add
missing SRI to native-built HTML.

### Serialization is a separate acceptance requirement

HTML attributes and an inline import-map JSON block need their respective safe
serialization. `JSON.stringify` alone does not prove safe embedding inside an HTML
script element. Existing Eta attribute escaping is not automatically a script-data
serializer. Review reuse of the existing renderer and the smallest necessary
serialization boundary before implementation; do not add a bundle/HTML rewriter.

Tests must include script-closing text, quotes, ampersands, control/Unicode sequences,
untrusted metadata and the actual CSP nonce. Reject unsupported manifest paths at
validation without treating that as permission to skip output escaping. The fixed
names in the browser fixture do not qualify arbitrary manifest-to-HTML serialization.
No existing framework injection defect is established by this unimplemented sketch.

## Preferred startup sequence, subject to the remaining gates

1. **Validate static data first.** At the application bootstrap owner, inspect the
   manifest/policy and available static declarations before opening infrastructure
   for them. This scope begins after required imports/discovery: imports, Proxy
   traps and arbitrary factory effects cannot be certified pure or rolled back.
   Do not call route factories to discover a return type or invoke them twice.
2. **Initialize through the existing context owner.** Await real providers and use
   the actual returned dependencies, kernel and renderer capability. Its current
   publication semantics remain explicit. Production migrations/provisioning and
   public artifact upload remain separate operator steps, not startup side effects
   introduced by this design.
3. **Collect into one local HTTP candidate.** The eventual collector must retain
   intact declaration ownership, handler/middleware/OpenAPI associations and the
   recognized matching-shape scope before installing shared metadata. Reuse the
   existing metadata owner for a local candidate; do not call today's eager global
   builder and label it staged. This requires a reviewed internal extraction, not
   an application workaround or a new router/container.
4. **Finish all candidate validation before bind.** Check renderer capability,
   route/method/collision policy and same-build document references. Keep primary
   causes separate from safe structured diagnostics. No network request, provider
   upload or preload `load` event proves that a candidate is valid.
5. **Install only the accepted metadata candidate, then bind.** The smaller proposed
   integration is a synchronous, ownership-checked snapshot operation on the
   existing registry object immediately before native construction. Preserve that
   object's shared identity. It must retain a copied prior snapshot and identify
   which candidate owns a subsequent restoration. Current `register/list/clear`
   calls are not an atomic snapshot protocol. Exact operation visibility, copy
   depth, public `RouteRegistry` extension behavior and registration hooks must be
   reviewed before any change. No implementation is supplied here.
6. **Use the existing lifecycle owner for failure and shutdown.** A successful bind
   must be integrated with stop/drain/flush/close before declaring HTTP ready.
   Construction failure stays a startup failure. Finish safe owned cleanup before
   restoring a previous metadata snapshot; restore only if this attempt still
   owns the installed snapshot. Changed ownership must be reported, not overwritten.

The fifth/sixth steps are a proposed first-publication protocol, not accepted atomic
application replacement. Copying rows, freezing a wrapper or checking one token
does not undo arbitrary factory effects or nested caller mutations. OpenAPI extension
data needs an accepted copy/validation boundary; do not JSON-clone arbitrary handlers
or bypass existing extension hooks. These requirements need characterization before
the registry extraction is implemented.

A provisional listener returning 503 until a later commit is a different design.
The low-level server has an `onRequest` hook, but the generated wrapper does not
expose a universal startup-readiness transaction, and native opaque asset values
are still excluded. Do not silently implement that alternative while describing
the smaller pre-bind protocol. If reversible snapshot ownership cannot meet the
accepted lifecycle contract, present that alternative separately before coding.

## Failure and rollback policy

Static-data rejection creates no new context/listener. A factory or capability
failure after provider publication belongs to the bootstrap attempt that acquired
that context. Raw route/server builders retain their existing caller-owned cleanup
contract. The generated bootstrap/App orchestration is the place for coordinated
cleanup; current package upgrades do not edit an existing app's generated source.

On bind failure, stop any listener actually acquired by the attempt and retain the
native cause. Drain admitted work, flush while dependencies remain available, then
close through the existing owners. Metadata restoration is conditional on observed
ownership and safe completion, not a `finally` that can clobber another mutation.

Failed drain blocks infrastructure close and automatic retry. Retain unresolved
candidate ownership for diagnosis rather than restoring old labels while live
provider work may still exist. A reported close failure may coincide with a
released socket, but one socket does not establish all resources were released.
Neither a cleared active context nor repeated disposal supplies a retry certificate.

Keep primary failure, cleanup outcome, metadata-restoration outcome and owned-resource
disposition separate. Diagnostics need a bounded stage/code/field/owner vocabulary;
exact names remain proposed. Do not serialize arbitrary errors, stacks, private
paths, credentials or raw invalid values into public diagnostics. Internal cause
identity should remain available without replacing the original failure.

Public artifact retention belongs to the independent delivery owner. Application
disposal must not delete objects still needed by old clients. A source/config/lock/
manifest rollback still needs matching public graphs and separate data-migration
acceptance; a metadata restoration alone is not a complete app rollback.

## Required evidence before implementation

- Pure/static rejection versus provider-ready failure; factories called once;
  invalid capabilities/paths/methods/owners leave no accepted metadata or listener.
- Successful candidate, native bind rejection, lifecycle registration failure,
  restoration of this attempt's prior metadata and refusal to overwrite changed
  ownership. Include public registry extensions and nested metadata mutation.
- Real admitted SQL/tenant work, failed drain, actual database-close failure,
  background worker/import side effects and failed cleanup with unresolved ownership.
  Keep the existing infrastructure-retention and transaction/RLS assertions.
- Renderer serialization under real CSP, complete known module metadata before
  requests, supported-browser policy and independent worker/resource scope.
- Provider HTTPS/cookie/CORS/publication and old-client retention, deliberate major
  per-app adoption, deprecation/support windows and data-aware rollback.

No runtime defect requiring a compatible patch is newly established by the four
ownership cases. Current partial registry effects are a known design limitation,
not a new promise to preserve them. The preferred major protocol is not ready for
implementation until its snapshot/extension/lifecycle and browser gates are accepted.

## Reproduction and validation boundaries

Copy the fixture unchanged as `consumer.test.ts` into a fresh owned package with
exact core/bootstrap 2.2.59 and Bun types 1.4.4. Strict-check against its installed
declarations without repository path aliases, then run Bun's native runner there:

```sh
bun --no-env-file test ./consumer.test.ts
```

The recorded environment explicitly uses an in-memory SQLite URL, array cache,
sync queue and local owned storage/temp roots. It does not contact a shared database
or use the separate app. The final drain case intentionally remains rejected; its
isolated test process exits after cleaning only its own socket. No general recovery
API is emulated. Failed/negative logs and exact package/fixture identities are retained.

Root types and scoped lint are separate checks. No full coverage/E2E, 159-profile
release rerun, push, PR, publication, deployment or timer restart is included in this
local design checkpoint.
