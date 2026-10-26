# M1 WebKit preload and Firefox launch investigation

This is a local design investigation on Bun 1.4.4/macOS 27.0.1 arm64, dated
25 October 2026. Prior browser sources, cases, receipts and the original red WebKit
control remain unchanged. No browser, package or framework runtime is patched,
no sandbox/privacy setting changes, and no app is modified. Breaking implementation
remains paused; shop is held for #257 and the timer stays off.

## WebKit: the earlier notification result had a narrower scope

The earlier seventeen-case graph run rejected altered code when the document also
supplied correct import-map integrity. That did not prove what an integrity-bearing
preload would do when no map followed it. The unchanged graph probe rerun still
executes all seventeen: sixteen pass and the same preload-event control fails;
the later mapped import remains rejected. No old expectation was changed.

The [new isolated diagnostic](../scripts/characterize-modulepreload-events.ts)
removes bundling and import-map dependency effects from the basic case. It uses
small explicit JavaScript bytes, their actual SHA-256 values, real HTTP requests,
strict CSP, native links/scripts/imports and fresh browser contexts. It records
the applied integrity attribute, before/after execution markers, events, errors
and each actual wire request. Native files/outputs are not rewritten.

Ten cases execute in Chromium 156.0.8078.4 and Playwright WebKit 27.2/build 2370.
The result separates two different expectations:

1. **Link/script event controls:** Chromium matches all ten expected events;
   WebKit differs in five integrity-bearing preload cases. Original bytes load,
   and 404/CORS rejection controls still reject, so a generic broken event harness
   does not explain the difference.
2. **A stronger persistent-rejection hypothesis:** several cases additionally ask
   whether a failed SRI-bearing operation prevents a later import without its own
   integrity metadata. That hypothesis fails in four cases in each engine. It is
   not asserted as an HTML guarantee or classified as four Chromium bugs. Those
   expectations remain red in the diagnostic; they were not relaxed to return green.

Consequently the complete diagnostic exits nonzero: six candidate outcomes match
and four fail in Chromium; four match and six fail in WebKit, with no cases skipped.
This is investigation evidence, not a replacement all-green compatibility gate.

### What actually executes

With altered bytes and an original digest, WebKit reports preload `load`; a later
unmapped import executes the altered module with **one observed module request**.
The same occurs on the application origin, so cross-origin handling alone does
not explain it. A wrong digest also reports preload `load`. Classic script preload
reports `load` on altered bytes too, while a subsequent actual script tag carrying
the digest rejects execution.

Chromium reports preload `error`. A subsequent import lacking integrity makes a
**second module request** and executes altered bytes. Direct module tags carrying
SRI reject execution in both engines; a later unverified import can likewise make
a new request and execute. Per-operation integrity rejection must not be confused
with a permanent URL ban.

Installing complete native import-map integrity before the preload makes the later
import reject in both measured engines. WebKit still reports preload `load`; its
event is not an integrity/readiness certificate. The correct map control protects
the measured window import, not workers or every arbitrary asset category.

The [HTML modulepreload algorithm](https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload)
passes link integrity into script fetch options and distinguishes failed from
successful preload events. The measured WebKit preload behavior is an upstream
engine limitation against that requirement, not a reproduced Strata runtime bug.
Shipping Safari and other browser/OS builds remain unqualified.

### Source-level explanation for the pinned build

The official Playwright 1.64.1
[WebKit configuration](https://github.com/microsoft/playwright/blob/v1.64.1/browser_patches/webkit/UPSTREAM_CONFIG.sh)
names base revision `56453fdfe0b0ca6258c23e6453b34f70b885d13f`.
At that revision,
[HTMLLinkElement](https://github.com/WebKit/WebKit/blob/56453fdfe0b0ca6258c23e6453b34f70b885d13f/Source/WebCore/html/HTMLLinkElement.cpp)
hands preload parameters to the loader without an integrity field;
[LinkLoader's parameter record](https://github.com/WebKit/WebKit/blob/56453fdfe0b0ca6258c23e6453b34f70b885d13f/Source/WebCore/loader/LinkLoader.h)
has no such member. The
[preload path](https://github.com/WebKit/WebKit/blob/56453fdfe0b0ca6258c23e6453b34f70b885d13f/Source/WebCore/loader/LinkLoader.cpp)
constructs its request without forwarding a digest and determines its event from
resource load failure. Stylesheet integrity has a separate check.

The official pinned Playwright bootstrap patch was also retrieved and checked;
it changes neither these link/preload files nor an integrity path. Source/patch
digests are retained locally. This explains the observed gap without attributing
it to current WebKit main or assuming that every later browser is affected.
No upstream issue or patch was posted by this work.

## Firefox: host app-data access, not a demonstrated Bun launch defect

The same pinned Firefox 157/build 1555 fails with fresh explicitly created profiles
under **both Node and Bun**, before any browser case executes. Both processes report
that the profile cannot be found. The previous canonical-path retry remains dated
evidence; moving the temporary profile was insufficient.

Metadata-only checks confirm that the owned profile root is accessible. The shared
Firefox app-data directory exists, is owned by the current user and has owner
permissions, yet opening a directory descriptor returns `EPERM`. No profile files,
history, cookies, credential files, directory contents or privacy database were read.

This strongly matches the existing upstream
[Playwright issue #42768](https://github.com/microsoft/playwright/issues/42768): its
report distinguishes the temporary profile from Firefox's shared app-data lookup
on macOS 27. The local evidence supports a host directory-access restriction and
rules out a Bun-only failure for these launches. It does not independently identify
the exact macOS privacy/sandbox rule, prove every upstream diagnostic claim or
qualify a Firefox browser run.

No Full Disk Access, TCC, quarantine, signing, browser branding, sandbox setting or
home-directory override was changed. No personal profile was used. A future pinned
Firefox run needs a supported environment where its normal startup can access its
own bookkeeping, or a reviewed upstream browser fix. Repeating the same host launch
or disabling security is not acceptance. The browser matrix remains open.

## Consequences for M1

The [API/lifecycle refinement](M1-API-LIFECYCLE-REVIEW.md) must bind a complete known
window-module integrity map to the same immutable build as the guarded document,
before any related request. Preload attributes supplement this; neither a preload
event nor an earlier failed SRI request protects every subsequent request. Do not
infer integrity from byte inventory alone or claim arbitrary-graph protection.

The selected public artifact origin remains the design target. There is no custom
loader, fetch/verify/eval workaround, worker relocation or bundle rewrite. A reviewed
supported-browser/integrity policy, renderer serialization, provider HTTPS/cookies/
CSP/CORS, Early Hints/redirects, worker/resource graphs and cached-client retention
remain implementation gates. The strict native large-pipeline and mixed
HTTP/WebSocket completion limitations remain unresolved.

All actual results, versions, raw-evidence digests, installed consumer checks,
retained failures and preservation controls are indexed in the
[sanitized receipt](qualification/m1-api-lifecycle-browser-2026-10-25.json).
Owned test sockets/processes close; only this run's disposable browser/package
scratch is cleaned. Historical inputs, outputs and failure receipts are retained.

## Reproduce the isolated event cases

With the pinned Playwright binaries installed in an owned browser directory, run
sequentially in fresh receipt directories:

```sh
bun scripts/characterize-modulepreload-events.ts /tmp/m1-events-chromium-new chromium
bun scripts/characterize-modulepreload-events.ts /tmp/m1-events-webkit-new webkit
```

Both commands currently exit nonzero for the explicitly retained expectations
described above. A launch failure is zero executed cases, not a pass or skip.
The separate Firefox Node/Bun launch receipts and directory-access check are local
evidence; no request to alter the user's browser/host configuration is made.
