# Public artifact origin: native integrity feasibility

The selected M1 target is an explicit public artifact origin. Application documents,
private downloads, authentication and ORM work stay on the guarded application
origin. This note records a bounded design check on 23 October 2026; it does not
implement a new route type, manifest API, provider, publishing step or major version.

## Confirmed SDK limitations and positive browser controls

The probe used Bun 1.4.3 revision
`c6da4a4d3010e5553438c60f6bd76d981976867c` and Chromium 156.0.8078.4.
It used actual native builds, separate loopback HTTP origins and real browser
requests. The native output files were not rewritten. Negative controls altered
only the bytes delivered by the fixture response.

Seven cases executed:

1. Native HTML without source integrity: Bun emitted absolute `publicPath` URLs and
   `crossorigin`, but no script or stylesheet `integrity`. The browser executed
   altered script bytes.
2. Native HTML with supplied source integrity: those attributes were absent from
   the built HTML. Altered script bytes again executed. Supplying attributes on
   pre-build input is not proof of integrity over the built output.
3. An independently authored app-origin document referenced native-built JavaScript
   and CSS with digests of the actual output bytes, `crossorigin="anonymous"` and
   a matching CSP. Original script execution and stylesheet application succeeded.
4. Altered script bytes were rejected by that document's SRI; the original
   stylesheet still applied.
5. Altered stylesheet bytes were rejected; the original script still executed.
6. Omitting the asset response's CORS header blocked the cross-origin module and
   stylesheet. A manifest digest alone does not supply browser CORS policy.
7. A separate native split-module build retained valid SRI on the unchanged entry
   script. An altered dynamically imported chunk nevertheless executed. Entry SRI
   is not a guarantee of integrity for the module graph.

The two native omissions and dynamic-import behavior are observations, not
compatibility assertions requiring future SDK versions to preserve a limitation.
The script keeps the positive SRI/CORS assertions and records native behavior so
an upstream correction can be assessed without weakening those assertions.

Relative `/api/probe` requests resolved to the application document's origin and
included its host-only fixture cookie. No recorded asset request included a cookie
or Authorization header. This is one HTTP-loopback host configuration, not proof
of production TLS, parent-domain cookie isolation or every browser's policy.

The [sanitized result](qualification/native-public-artifact-integrity-2026-10-23.json)
records case outcomes and the probe/raw-receipt hashes. A passing characterization
means that its controls executed successfully; it does not mean native SRI or
lossless native delivery has been qualified. These seven SDK/browser cases do not
increase the separately established 130 published framework profiles.

## Consequences for the proposed M1 contract

Keep the guarded HTML document on the application origin. A validated manifest
must describe selected native build outputs and their exact digests; it must not
claim that those digests are automatically enforced by browsers. Uploading HTML,
adding `publicPath`, or merely recording a digest does not establish SRI.

Two document ownership paths still need a concrete design decision:

- If native-built HTML must remain byte-identical, qualify supported native
  integrity emission before promising script/style SRI. The tested build does not
  provide it. Do not rewrite native output or remove the integrity requirement to
  hide this limit.
- A guarded application view could author script/style tags from a validated
  native-output manifest. The positive browser control demonstrates that browser
  mechanism, not a completed Strata manifest/view integration or migration. This
  path still requires an accepted API, source ownership and real generated-app
  tests before implementation.

Either path must specify the promised integrity scope. Entry tags alone do not
qualify dynamic imports, static module dependencies, workers, CSS dependencies,
images or fonts. Before a graph-wide guarantee, qualify the chosen native/browser
mechanism against altered dependencies. Do not silently disable existing features,
rewrite bundles, add a proxy or describe entry-only SRI as graph protection.

The first static delivery provider, HTTPS/CSP/CORS policy, full cookie scope,
artifact retention, old/new cached clients and operational ownership remain
unqualified. A loopback Bun fixture is not a selected production delivery engine.
The known native asynchronous-pipeline truncation and mixed HTTP/WebSocket abort
reporting limits in [HTTP response drain](HTTP-RESPONSE-DRAIN.md) remain unresolved.

## Reproduce without changing application behavior

Use the repository's installed Playwright/Chromium and a new owned output directory:

```sh
bun scripts/characterize-native-artifact-integrity.ts /tmp/strata-native-integrity-new-run
```

The command refuses an existing directory, retains native inputs/outputs and a raw
receipt, and closes its own browser and two fixture listeners. It neither publishes
artifacts nor changes framework runtime code, packages, databases, Redis or the shop.
This is an opt-in characterization, outside the ordinary unit/E2E counts. Repeat it
for the exact runtime/browser selected for an eventual implementation.

The script now retains these original seven controls and adds three native
[import-map integrity controls](PUBLIC-ARTIFACT-MODULE-INTEGRITY.md). The historical
seven-case receipt remains unchanged; the separate ten-case receipt records the
additional pinned-browser evidence without accepting a framework API or a general
module-graph guarantee.

Fixture preparation errors were retained separately: the initial TypeScript probe
used browser globals absent from the server project; the first string-expression
revision returned a function instead of invoking it. Only the fixture expression
was corrected. No browser integrity, CORS, cookie or image assertion was removed.

The timer remains off and shop adoption remains held for #257. Breaking changes,
provider deployment and another runtime release are not part of this check.

## Primary references

- [Bun publicPath](https://bun.sh/docs/bundler#publicpath) documents native URL
  generation; the pinned output receipt establishes the observed integrity behavior.
- [Bun HTML bundling](https://bun.sh/docs/bundler/html-static) documents processing
  local HTML dependencies. Documentation is not a substitute for the pinned probe.
- [W3C Subresource Integrity Recommendation](https://www.w3.org/TR/2016/REC-SRI-20160623/)
  describes integrity verification and cross-origin eligibility.
- [HTML CORS settings](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attributes)
  defines the credential behavior of `crossorigin` attributes.
