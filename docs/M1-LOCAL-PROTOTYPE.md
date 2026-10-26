# M1 local implementation for design review

Current follow-up: [26 October qualification](M1-QUALIFICATION-2026-10-26.md).
The gate counts below describe the earlier tree; the follow-up retains all earlier
assertions and records new fixes, browser/TLS and adoption evidence separately.

This is an **unpublished review prototype**, based on release 2.2.59.
It implements the selected explicitly public artifact origin and one guarded
application listener. It does not approve the major-version contract, change the
published release, or migrate existing applications. The earlier design documents
are retained byte-for-byte as historical inputs; their “no implementation” status
describes those earlier checkpoints.

Review worktree: `/tmp/strata-m1-local-implementation`, branch
`codex/m1-local-implementation`. The human has authorized a draft PR for design review. Its earlier qualification
was performed before committing; merge, release, deployment and adoption remain
unapproved. The separate app is untouched. Shop adoption stays
**held for #257** and the timer stays **off**.

## What is implemented

The provisional `@getstrata/bootstrap/m1` subpath exports:

- `collectPublicArtifactManifest`: explicitly select actual native `Bun.build`
  outputs and record their relative path, media type, byte length and SHA-256.
- `verifyPublicArtifactFiles`: compare retained manifest bytes immediately before
  publication. Selection excludes HTML and source maps and rejects symlink escapes.
- `createPublicArtifactResolver`: validate unknown plain manifest data and the
  application-owned origin/release-prefix policy, then copy and freeze it. A
  manifest cannot choose its own origin. HTTPS is required except for an explicit
  loopback-only test option.
- `prepareDocumentArtifacts`: require a same-build document plan and return
  immutable entry scripts, stylesheets and escaped import-map JSON. Every declared
  entry script must have a window-module integrity entry.
- `defineApplicationRoutes`: native Bun request parameters, server types and
  response handlers, without accepting opaque HTML bundles/files as guarded routes.
- `startGuardedApplication`: provider acquisition, renderer capability validation,
  one-time route collection, collision checking, metadata publication, native bind,
  and shutdown through the existing provider/kernel/server/lifecycle owners.

Implementation is in [the M1 directory](../src/bootstrap/m1/index.ts). Existing
2.x entrypoints remain available. Nothing automatically emits the new API into
starters or adopts it in existing apps.

## Concrete application shape

This illustrative module runs against this worktree's source aliases or locally
packed candidate. It is not available in registry-installed 2.2.59.

```ts
import { defineApplicationRoutes, startGuardedApplication } from "@getstrata/bootstrap/m1";
import type { BunRequest } from "bun";

const application = await startGuardedApplication({
  apiPrefix: "/api",
  modules: [{
    name: "notes",
    routes: ({ kernel }) => defineApplicationRoutes()({
      "/notes/:id": {
        GET: kernel.wrapAuthenticated<BunRequest<"/notes/:id">>((request) =>
          Response.json({ id: request.params.id })),
      },
    }),
  }],
  transport: { port: 3000 },
});

// Register this with the application's existing signal owner.
const result = await application.shutdown("MANUAL");
if (!result.successful) throw new Error("Application shutdown needs investigation.");
```

The default providers retain their existing application configuration requirements.
The prototype defaults its listener to loopback; deployment must deliberately
choose transport settings. Domain authentication/authorization remains explicit in
handlers through the existing kernel, policies and repositories. Global request,
auth, membership, tenancy and response middleware remain framework-owned.

For HTML, provide `documents: renderer` or the existing `CORE_VIEW_RENDERER_TOKEN`
capability. A frontend label alone does not create a renderer. A module's
`webRoutes({ documents, kernel, cachedJson })` returns strict raw handlers; **the new
M1 web contract applies flash and configured CSRF automatically**, including to an
API-labeled app with an actual renderer. Existing 2.x web builders retain their
conditional group behavior. Migrating previously wrapped legacy web factories
requires reviewing wrappers to avoid duplicate flash/CSRF processing.

Supply `artifacts: { manifest, policy, document }` to prepare trusted
`publicArtifacts` renderer data. Caller-supplied view data cannot override it. A
reviewed Eta template can emit `publicArtifacts.importMapJson` as script data
**before any module request or preload**, with the framework request's CSP nonce;
entry scripts and stylesheets use the corresponding URL, integrity and anonymous
CORS attributes. The working [browser fixture](../scripts/characterize-m1-prototype.ts)
demonstrates this with the existing CSP configuration and real Eta renderer.
The prototype does not rewrite generated HTML or install a custom module loader.

## Changes relative to the proposal

Providers still become ready using the current context API before HTTP collection.
A packed-entry regression checks the public `appContext` facade. M1 imports the
existing public context entrypoint so bundling does not create a private second
copy of its readiness state.
A local route candidate is not a second application context. The existing metadata
registry receives a bounded `installSnapshot` operation, preserving its identity
and invoking its hooks. Publication validates the post-hook rows, and successful
shutdown restores the previous copied snapshot only while ownership is unchanged.
Plain/null-prototype metadata records preserve their prototypes and are frozen;
getters, cycles, classes, symbols and non-data values are rejected by this operation.
Ordinary existing `register`, `list` and `clear` calls retain their contracts.
Arbitrary hook side effects cannot be rolled back.

Strict route declarations require absolute conservative ASCII paths, unique named
parameters and terminal wildcards. Matching-shape duplicates across modules or
API/web groups fail, even with disjoint methods. Case and trailing slash remain
significant. A bare callback is GET; a Response covers six non-OPTIONS methods.
Native HEAD fallback and framework OPTIONS remain visible in the inventory.
Request parameters retain Bun's decoding behavior; encoded declaration aliases are
not introduced. The M1 listener explicitly disables implicit cwd public-file fallback.

Startup validates lifecycle settings before claiming one shared reservation and
acquiring providers. Static failures acquire neither providers nor a reservation.
Later owned failures retain the original cause, dispose the
returned context and restore metadata before allowing a corrected retry. A failed
drain/close or changed metadata ownership remains a reported failure, with retry
blocked. This is not a force-close or hot-replacement facility.

**Unresolved lifecycle choice:** when provider creation rejects before returning a
context, the current API supplies no structured cleanup disposition. The prototype
retains its startup reservation even if a fixture observed resource cleanup. It
requires process recovery rather than claiming a retry certificate. Approval must
resolve whether a narrow provider cleanup-result contract is needed. Module import,
worker and arbitrary callback side effects are not transactional.

Native `BuildArtifact` values are file-backed. Collection attests the bytes read
under producer ownership, not an immutable original compiler buffer. Same-length
tampering before the first capture cannot be detected from that mutable handle.
Retain the manifest and verify files before publication; provider atomic publication
and retention policy remain separate decisions.

## Evidence and limits

New native tests cover strict inputs, methods/collisions, snapshots/hooks,
capabilities, cookie/token/origin admission, real bind rejection, cleanup failures,
changed ownership, retry boundaries and preserved primary causes. They include
failing-before/passing-after evidence for the raw web CSRF gap discovered during
implementation. Existing test source, assertions, platform skips and coverage
thresholds/exemptions are unchanged. The local `unit` command uses the same Bun
file isolation as the existing coverage gate so intentionally failed runtime owners
cannot leak between files.

The packed consumer checks installed declarations without repository aliases and
runs actual PostgreSQL ORM work during an admitted HTTP request. Shutdown keeps
the pool available until that request completes, then closes it and restores prior
metadata. A separate probe verifies source/packed startup reservation identity.
Tarballs retain version 2.2.59 only as local candidates; this is **not** a claim of
registry-published qualification.
The retained [packed context E2E test](../tests/e2e/m1PackedContext.test.ts) checks
public facade identity, disposal and a corrected second startup against installed
candidate tarballs.

Chromium checks real native JS/CSS outputs, guarded Eta/API requests, rejection of
altered deferred bytes, and A→B→A restart with old A/B windows retaining their own
chunks. This is a bounded integration fixture, not a provider implementation or a
populated major-version migration rehearsal.

Receipts and original failed logs live outside the repository in
`/tmp/strata-m1-local-implementation-evidence-20261025`. The full gate result must
be read from `full-validation-reviewed-outcome.json` and `full-validation-reviewed.log`;
focused tests alone do not establish full regression acceptance.
That final gate passed: 3,077 unit/integration tests, the three existing skips,
zero failures, and 201 E2E cases with no failures/skips. All 157 enforced files
meet 100% coverage; the 272 existing exemptions are unchanged. Package/export,
strict type, 30 generated-app compiler combinations and extras/SPA checks pass.
The prototype-focused suite separately passes all 87 tests. Re-running requires
fresh disposable fixtures and a new evidence root; the recorded resource receipts
are historical evidence rather than reusable cleanup targets.

Before treating M1 as a release contract, review API names/typing, the conservative
grammar and metadata extension restrictions, provider rejection/retry semantics,
public-origin HTTPS and cookie-domain separation, CSP/CORS and redirect/Early Hints
policy, publication/retention, all required browser engines, complete supported
resource graphs, and populated per-app migration/deprecation/rollback. WebKit's
preload-event discrepancy and the local Firefox launch failure remain recorded in
the [browser investigation](M1-BROWSER-INTEGRITY-INVESTIGATION.md); no browser policy
was relaxed. Whole arbitrary graph integrity, the native 64 MiB delivery limit and
mixed HTTP/WebSocket completion attribution are not solved by this prototype.
