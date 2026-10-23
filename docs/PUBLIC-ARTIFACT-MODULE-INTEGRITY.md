# Public artifact origin: native import-map integrity

The selected M1 design keeps application documents on the guarded application
origin and explicitly public build outputs on a separate origin. The earlier
seven-case probe showed that entry SRI alone did not protect an altered dynamic
import. This follow-up qualifies one native browser mechanism for that gap;
it does not implement a Strata manifest, view adapter or public-assets API.

## Actual pinned result

The probe used Bun 1.4.3 revision
`c6da4a4d3010e5553438c60f6bd76d981976867c` and Chromium 156.0.8078.4.
All ten browser cases passed: the original seven controls, with all 29 original
assertion call sites retained, plus three import-map cases and seven new call sites.

The new cases use the same unchanged native Bun split-module output: one entry
and one dynamically imported JavaScript chunk. A separately authored app-origin
document supplies native import-map `integrity` metadata from the exact output
digests. Its inline map has a matching CSP nonce; old document policies are
unchanged. Entry SRI and anonymous cross-origin module requests remain present.

1. Correct metadata with original bytes executes the entry and original chunk.
2. Correct metadata with altered wire bytes blocks the dynamic chunk with a
   native digest error. The unchanged entry and relative app-origin API request
   still execute.
3. Omitting the chunk's metadata allows the altered chunk to execute in this
   pinned browser. A map covering only the entry is not graph protection.

The [sanitized receipt](qualification/native-import-map-integrity-2026-10-23.json)
records every case, native browser errors, request credential-presence controls,
runtime versions and source/raw-receipt hashes. All recorded asset requests lack
Cookie and Authorization; relative API requests carry the app-origin fixture
cookie. This is one HTTP-loopback configuration, without a production cookie or
TLS guarantee. The owned browser and listeners closed, and every captured
SQL/Docker metadata field returned to baseline.

Native outputs were not rewritten. Deliberate fixture response tampering is the
negative control. There is no fetch/verify/eval fallback, replacement module loader,
browser patch, disabled module feature or application runtime workaround.

## Design implications and remaining gates

The [HTML standard](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps)
defines import-map integrity metadata. The runtime result establishes the tested
dynamic-import behavior in the pinned Chromium build; the standard alone is not
runtime acceptance. The fixture map is processed before the importing entry.

A guarded app-authored document could consume a complete, validated native-output
snapshot to supply entry tags and module integrity metadata. That remains a
proposal requiring exact API/source ownership and generated-app migration review.
The native Bun HTML output still omits the earlier supplied integrity attributes;
this probe does not add attributes or maps to native-built HTML automatically.

Do not claim all-browser or whole-asset-graph integrity. Other supported browsers,
static shared-module graphs, workers, stylesheets and their dependencies,
images/fonts, redirects, preload ordering, cached clients and deployment/rollback
remain separate qualification work. Unlisted modules remain an explicit negative
control. A production design needs a complete selected module inventory and a
reviewed supported-browser policy, rather than silently falling back to entry-only
integrity or removing supported features.

The [native static-engine result](PUBLIC-ARTIFACT-STATIC-ENGINE.md) is separate.
These small loopback browser cases do not qualify a provider or lossless delivery,
fix Bun's original strict 64 MiB pipeline failure, or resolve mixed HTTP/WebSocket
abort reporting. No breaking implementation, version bump, publication or shop
adoption is included. Shop adoption remains held for #257 and the timer stays off.

## Reproduce

```sh
bun scripts/characterize-native-artifact-integrity.ts /tmp/strata-import-map-new-run
```

Use the installed Playwright/Chromium and a fresh evidence directory, sequentially
with native/full validation. The command retains native inputs/outputs and the
receipt, closes its own browser/listeners and records partial observations on a
failure. A failed or incomplete run is not acceptance. The ordinary unit/E2E and
published framework profile counts remain separate from these ten browser cases.
