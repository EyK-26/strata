# M1 public-artifact graphs: feasibility and API refinement

Status: design and opt-in feasibility only, 25 October 2026. The selected target
remains an explicitly public artifact origin, with guarded documents and application
work on the application origin. Breaking implementation remains paused. This adds
no runtime export, resolver, validator, publisher, generated code or delivery service.
The separate app is unchanged, shop adoption remains held for #257, and the timer
stays off.

This continues the [guarded HTTP contract](M1-GUARDED-HTTP-CONTRACT.md) and
[startup proposal](M1-STARTUP-VALIDATION-PROPOSAL.md). Their earlier evidence remains
dated evidence; this document does not replace the frozen M0/M1/M2 plan. The current
compatible baseline is released 2.2.59 at
`a87baf07126b14b6d1ce3898c6b59e9eb512ce35`. Its release qualification is separate
from these major-design experiments.

## Actual results and classification

The [new opt-in probe](../scripts/characterize-public-artifact-graph.ts) uses native
`Bun.build`, actual emitted bytes, native browser modules/workers and two finite
loopback HTTP fixtures. It never rewrites emitted outputs. Negative cases alter
only response bytes; no custom loader, fetch/verify/eval bridge, worker proxy,
sandbox disablement or relaxed CSP makes a case pass. The application fixture
requires its own cookie, and recorded public requests contain neither Cookie nor
Authorization. This is a transport fixture, not a new Strata integration.

The [sanitized receipt](qualification/m1-artifact-graph-2026-10-25.json) separates:

- **Retained evidence:** the unchanged earlier ten browser cases pass on Bun 1.4.4
  and Chromium 156.0.8078.4. All 43 unchanged compiler cases pass with TypeScript
  7.0.2 and Bun types 1.4.4: thirteen proposed positives, twenty-three rejections,
  six known type limits and one current compatibility case. These remain finite
  observations, not accepted public APIs or a bug-free baseline.
- **New bounded Chromium evidence:** all seventeen cases execute: ten controls and
  seven observations, with no failures/skips. A deliberately incorrect first-case
  expectation fails with the actual original entry still recorded; restoring the
  normal input produces seventeen successful outcomes again. The observation cases
  record gaps, rather than asserting that those gaps must remain forever.
- **Browser difference:** Playwright WebKit 27.2 executes all seventeen cases;
  sixteen pass and one control remains red. An integrity-bearing module preload
  reports `load` instead of the control's expected `error`, but the subsequent
  altered module is rejected with a digest error. This is a notification difference,
  not observed execution of code that failed SRI. The assertion was not weakened.
- **Unqualified browser:** Firefox 157/build 1555 fails before any case executes.
  macOS reports a sandbox-extension/profile launch failure, including with
  canonical owned paths. There is no Firefox browser result or skipped-case
  acceptance. Its sandbox and host settings were left intact.
- **SDK observation:** actual native font/image outputs are absent from
  `metafile.outputs` in this fixture. Empty CSS import metadata also fails to describe
  the authored resource dependencies. These are observed metadata limits, not a
  proof of arbitrary graph completeness and not behavior to preserve as a guarantee.
- **Confirmed framework defects:** none newly established by this graph probe.
  Existing native large-pipeline and mixed HTTP/WebSocket completion limitations
  remain unresolved; a public-origin proposal does not fix them.

The WebKit result is a Playwright build result, not qualification of shipping
Safari. No all-browser, HTTPS/provider, arbitrary asset graph or major migration
acceptance is claimed. Failed setup runs and both browser failures remain in the
local evidence record with their original receipts and logs.

## What the graph experiments establish

### Window modules and preload ordering

The native build emits two window entries, a shared module and a deferred module.
With exact integrity metadata for their URLs processed before module requests,
Chromium rejects altered shared and deferred bytes. The original shared module
evaluates once across the two entries. Removing shared-module metadata allows
altered shared code to execute; entry SRI alone is insufficient.

Chromium also caches an altered deferred module through an unverified
`modulepreload` completed before the import map. A later correct map does not
retroactively protect that fetch: the altered deferred module executes. In the
same ordering observation WebKit rejects the later import. Neither result permits
a cross-browser guarantee from a late map. Supplying integrity on the earlier
preload blocks execution in both measured engines, while WebKit's event differs.

The [HTML import-map rules](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps)
and [modulepreload processing](https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload)
describe native mechanisms; the measured engine results bound this proposal.
Do not use preload `load` alone as an integrity or application-readiness certificate.

### Workers have their own ownership and graph

A module Worker at the public origin is rejected by the native Worker constructor
in the measured engines, despite the fixture permitting that origin in CORS/CSP.
The same worker served by the guarded application origin works and carries its
application cookie. Its native child import still targets the public origin.

Document import-map integrity does not protect either the worker entry or its
child here: altered worker entry/child bytes execute in the respective observations.
The [Worker constructor contract](https://html.spec.whatwg.org/multipage/workers.html#dom-worker)
is a separate boundary from window module metadata. No automatic relocation,
URL rewriting, blob worker or new worker loader is proposed. Keep workers explicitly
owned and qualified separately; publishing a window graph must not silently publish
or relocate application workers.

### CSS digests and resource trust are distinct

Native local CSS imports are bundled, and the fixture font/image become data URLs
inside native CSS output. Stylesheet SRI rejects altered stylesheet bytes, including
those embedded bytes. Original styles, nested style, font loading and image data
remain asserted.

A second authored CSS input points at actual separately emitted native font/image
files. Its source URLs are set before building, not patched into an emitted bundle.
With the stylesheet unchanged and valid, altered external image bytes render with
different natural dimensions. A valid font with sixteen appended zero bytes also
loads despite a different digest. This proves accepted changed wire bytes, not a
changed glyph or arbitrary malformed-font acceptance. JavaScript integrity metadata
and the parent CSS digest do not enforce those independent resource digests.

If the acceptance requirement is browser-enforced integrity for every arbitrary
asset dependency, this design still lacks that guarantee. Do not call the gap fixed
by recording more hashes, omitting an asset category or inventing an integrity
attribute that its consumer does not enforce. A narrower advertised integrity scope
would require an explicit design decision; it is not silently adopted here.

### Retention includes deferred dependencies

An already open A document and a new B document both load their own deferred chunks
when both immutable release trees remain available. Returning new documents to A
keeps the measured B client working too. Removing A's not-yet-requested deferred
chunk gives the old A client a real 404 and rejected import; it does not switch to B.

This is an open-document/deferred-import rehearsal. It does not qualify browser
restart, service workers, CDN invalidation, offline behavior, a retention duration or
populated-data migration. The public byte owner must retain the whole selected old
release graph independently of application shutdown; keeping an old entry alone
is insufficient. An application rollback must select matching document, manifest,
source/config/locks and retained public bytes, with data migration checked separately.

## Refined proposal for review, still unimplemented

1. **Inventory actual selected outputs.** The build adapter enumerates native
   `BuildArtifact` outputs and hashes their exact bytes. It compares destinations
   before publication and keeps guarded HTML, private source maps and private files
   out of the public list. Native metadata helps describe known module edges; it
   cannot alone certify all outputs or arbitrary URL/dynamic/plugin dependencies.
   Record missing/unknown edge information as uncertainty, not an empty complete
   graph. Do not add a second JavaScript/CSS parser or replacement bundler to hide it.
   See the native [Bun bundler API](https://bun.sh/docs/bundler).
2. **Keep the small immutable manifest seam.** Retain the proposed logical names,
   relative output paths, media types, byte lengths and digests. The operator policy
   remains the sole approved HTTPS origin/prefix owner. Keep the existing own-key,
   copy/freeze, path containment and duplicate-destination proposal. Per-consumer
   graph provenance belongs to the build review record; this checkpoint does not
   accept another exported type hierarchy or a global current-manifest pointer.
3. **Bind one document snapshot before requesting modules.** A build-time reviewed
   list identifies the logical modules needed by that guarded document. Its existing
   renderer resolves the complete list against the same frozen build snapshot before
   emitting entry tags, the native import map or preload instructions. A missing name
   is an error, not cross-build fallback. Review exact renderer/list ownership and
   API shape before implementation. A preloaded URL needs its integrity at that
   initial request; no early request may rely on metadata that arrives later. HTTP
   Early Hints and other request initiators remain unqualified, not automatically
   solved by ordering the document tags.
4. **Keep integrity scope explicit.** Exact byte digests are publication evidence.
   Native browser enforcement depends on consumer type and supported engine. Keep
   window modules, workers, embedded CSS bytes and external font/image dependencies
   distinct in the review. No worker relocation or universal graph-integrity claim
   follows from a successful window import-map test. Preserve strict CSP and real
   CORS/credential controls without adding a custom loader.
5. **Publish before selecting a release.** Use the chosen provider's supported SDK
   or tool to publish only the owned enumerated public bytes. Verify provider-visible
   lengths/digests, headers and graph availability before selecting the matching
   guarded document. Publication failure must leave the previously selected build
   intact. Partial-upload cleanup and reported failure are separate facts; only
   known owned objects may be removed. No request-time upload, universal publisher
   abstraction or automatic retry certificate is selected.
6. **Retain old graphs and make rollback deliberate.** Application lifecycle cleanup
   must not delete still-referenced immutable release objects. Choose a supported
   client/retention policy before any automated retirement. Rehearse an old open
   client, new client and source/manifest rollback with matching retained graphs.
   This extends the existing per-app migration/deprecation/rollback review; it
   authorizes no major implementation, existing-app overwrite or deployment.

Native built HTML remains unchanged. The earlier native HTML/SRI omission is not
corrected by these separately authored document fixtures. Selecting the actual
guarded renderer/build integration remains a design gate.

## Remaining acceptance gates

- Accept exact route/manifest/renderer/export and safe diagnostic ownership,
  including the intact-declaration collision scope and staged startup/lifecycle
  responsibilities from the earlier proposal. Real SQL work during failed drain,
  actual database-close failure and worker/import side effects remain separate
  startup feasibility work.
- Define supported browsers and investigate the WebKit notification discrepancy
  without claiming a demonstrated SRI bypass. Obtain an actual Firefox run in a
  supported environment. Redirects, preload/HTTP Early Hints, workers, plugin output,
  source maps and unenumerated dependencies need explicit scope and tests.
- Select a production delivery owner and qualify HTTPS, cookie-domain isolation,
  CSP/CORS, MIME, interruption/range/cache behavior and actual HTMX/SPA consumers.
  The previous local static-engine controls remain useful but are not provider
  acceptance. A different port alone is not credential isolation.
- Accept major per-app source/configuration adoption, deprecation/support windows,
  populated-data migration, cached clients and retention/rollback. Existing
  generated apps do not adopt a design or source patch through a package upgrade.

No new API is ready for breaking implementation at this checkpoint. The selected
public-origin direction is feasible for the bounded native outputs and window
consumer tested here, with the limits above. It is not an approved whole-graph
integrity or lossless-native-asset guarantee.

## Reproduce and validation scope

With Bun 1.4.4 and installed Playwright browser binaries, use fresh owned directories
and run sequentially with other native/full suites:

```sh
bun scripts/characterize-native-artifact-integrity.ts /tmp/m1-retained-browser-new
bun scripts/characterize-http-contracts.ts /tmp/m1-retained-types-new
bun scripts/characterize-public-artifact-graph.ts /tmp/m1-graph-chromium-new
bun scripts/characterize-public-artifact-graph.ts /tmp/m1-graph-webkit-new --browser=webkit --continue-on-failure
bun scripts/characterize-public-artifact-graph.ts /tmp/m1-graph-firefox-new --browser=firefox
```

The latter two commands are not promised green. `--continue-on-failure` retains
failed assertions, records all subsequent cases and exits nonzero if a control
fails. An engine launch failure executes zero cases. Receipts preserve source,
fixture and input hashes, actual counts, errors and native output inventories;
browser/listener cleanup runs in `finally`.

Root TypeScript and scoped Biome checks pass. Existing runtime, package, test and
earlier probe bytes remain unchanged; all twenty-six frozen plan files are
preserved. These opt-in cases do not replace ordinary coverage/E2E or published
consumer scenarios, and no full-suite rerun is claimed for this local design-only
checkpoint. No push, PR, version change, release or timer restart is included.
