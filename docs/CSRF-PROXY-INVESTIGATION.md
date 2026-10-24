# HTTPS-terminating proxy and cookie-form investigation

This is the **initial 2.2.54–2.2.56 investigation record**. Its no-setting behavior and historical failure logs are preserved. The subsequently accepted opt-in target-origin contract is documented in [PRODUCTION.md](PRODUCTION.md#https-termination-and-cookie-forms); the implementation/qualification follow-up is below. Initial statements that no replacement existed describe the investigation point, not a claim about later releases.

Observed 2026-10-24 with native Bun 1.4.4. Framework baseline and freshly read remote main: `0614b51c1a6e6961d34494bced0aa0a584c474ff` (2.2.56). Published core/bootstrap 2.2.54 and 2.2.56 tarballs were downloaded from npm and verified against their SHA-512 integrities. No framework runtime, generated template, dependency, package version or existing test/assertion changed in this investigation.

## Classification and limits

- **App configuration:** the inspected source follows the documented generated pattern. No app misconfiguration was demonstrated. This is not an assertion that every private hosted setting is correct: private environment files and the live service were not accessed.
- **Framework integration:** confirmed missing supported CSRF target-origin configuration for HTTPS termination followed by an HTTP upstream. The failure is reproducible with a correctly configured public origin, independently of the app. It is an interoperability defect/limitation, not evidence that token verification is broken or that hostile origins should be admitted. No existing documented setting fixes this topology without the adapter.
- **Documentation:** confirmed gap. Production guidance requires public HTTPS `APP_URL` but previously did not distinguish it from CSRF's transport-derived target. The production guide now records that limitation and the scope of the existing proxy flags.
- **Provider assumption:** Render's documented TLS termination/HTTP upstream matches the incident. Exact current ingress headers, overwrite rules, socket peers and backend network access remain private checks for the app agent. No new hosted reproduction or deployment is claimed.
- **Adapter removal:** not qualified. No framework replacement has been implemented or demonstrated; upgrading 2.2.54 to 2.2.56 alone does not replace it.

Confirmed limitations and syntax observations below are not compatibility guarantees to freeze into a future implementation. Retained rejections and valid direct/native-TLS flows are the relevant security/compatibility controls.

## Reconstruction from read-only app evidence

The app is `~/perso/clientelo/deployment-experiment`. Relevant source is `src/http/publicOrigin.ts`, its `tests/publicOrigin.test.ts`, `src/modules/site/index.ts`, `src/bootstrap/{config,createApp,server,preload}.ts`, `src/bootstrap/providers/{config,auth}.ts`, `strata.layers.json`, `package.json`, `Dockerfile`, and root `render.yaml`. Only selected authored sanitized deployment records were read, not private environment files or the app's `.env` probes. Their selected input hashes are retained in the external evidence folder.

The original request was a genuine HTTPS `POST /etf` containing the rendered CSRF token/cookie and invalid email input. It should reach validation and return 422 without storage or mail. The sanitized record `evidence/29-live-proxy-and-mail-checks.txt` reports an unexpected 403 after the first corrected deployment. Its invalid-input-only diagnostic reached 422 with an HTTP Origin and returned 403 with an HTTPS Origin. `evidence/25-proxy-csrf-red.txt` separately shows a signed token that verifies, followed by rejection of HTTPS browser Origin versus an HTTP backend URL.

In core `src/core/http/csrfMiddleware.ts`, mutating anonymous/cookie requests first pass `verifyCsrfToken`. The following origin comparison then throws `ForbiddenError("Cross-site cookie requests are not allowed.")` because `https://public-host` differs from `http://public-host`. The exact original backend packet/headers and socket peer were not recorded; scheme loss is independently reproduced below rather than inferred solely from the manifest.

The app adapter runs **before** `kernel.wrapWeb`. It leaves an already matching request unchanged. Otherwise it accepts only an HTTP incoming URL whose complete host/port equals the configured HTTPS public URL, and creates a Request at that configured origin with the original path/query and request data. It does not change the browser Origin, token, cookie or CSRF middleware, and does not consult forwarded headers. A nonmatching host returns null; the app returns 400. It is a URL transformation, not a trusted-proxy authenticator.

The recorded adapter red/green tests (`evidence/26` and `27`) and the 42-test run (`28`) support the local result. Record `29` reports deployed invalid-input 422 and missing-token 403 after source revision `71194cb`. Record `30` adds hostile-Origin 403 across redeployment. The newer `43-hosted-2256-upgrade.txt` reports a 2.2.56 deployment at `9a53f386`, retaining the adapter and passing invalid-input, invalid/missing-token and hostile-Origin controls. These are app-agent-authored sanitized records, not raw transport captures or independent hosted checks by this investigation. Earlier records that still say hosted upgrade is pending are historical snapshots.

## Configuration and generated-pattern audit

`loadConfig` maps `APP_URL` to `appUrl`; the config provider registers `app.url` and the generated public tenant-host resolver. `HOST=0.0.0.0` reaches `native.hostname`; it is not a public origin. `renderBootstrap.ts` generates the same separation. Production secrets guard checks `APP_URL`; the app additionally requires a public HTTPS origin with no credentials/path/query/fragment. The manifest intentionally leaves the actual `APP_URL` private (`sync: false`), so it proves no hosted value.

The profile is server-HTMX, headers auth, tenancy none. Production `AUTH_DEV_HEADERS=false` yields no authenticated development principal. Anonymous forms therefore retain CSRF protection; the presence of an auth header alone is no exemption. The public tenancy binding is not a general host allowlist when tenancy is disabled.

CSRF cookies are signed and double-submitted; production sets Secure, HttpOnly, SameSite=Lax and Path=/ independently of the internal URL's scheme. The browser test receives and sends the Secure cookie over the external TLS connection. In the controlled reproduction, cookie delivery/token verification are not the failure.

`CORS_ALLOWED_ORIGINS` changes CORS response headers, not CSRF admission. `TRUST_FORWARDED_FOR` affects IP attribution only. `PublicTenancyOptions.trustedProxyAddresses` reads actual `RequestMeta.peerAddress` and authorizes `X-Forwarded-Host` for tenant selection only. Neither `X-Forwarded-Proto` nor `Forwarded` defines CSRF's target. No general `trustProxy` or CSRF expected-origin setting was found. Relevant CSRF, cookie, client-IP and tenant-host source is byte-identical from 2.2.54 to 2.2.56.

## Executable evidence

The locally reviewable suite is [csrfProxy.integration.test.ts](../tests/integration/csrfProxy.integration.test.ts). It uses `Bun.serve` for an owned loopback HTTPS edge and the public `createWebServer` API for an independent HTTP backend. The edge preserves Host/body/browser Origin and overwrites forwarding headers with known fixture values. All outbound targets and listeners are owned; there is no database, application boot, mail provider or remote service access. Certificates and listeners are cleaned after the suite. The test adapter is an isolated copy of the inspected adapter's behavior, not a new production mechanism.

The same suite is run from clean temporary consumers, using source aliases or the integrity-verified published exports. Each target passes **21 tests, 151 assertions, zero failures/skips**. Chromium is driven inside Bun's native test runner for an actual browser GET, Secure-cookie storage, hidden token and normal HTML-form POST. Other negative cases use real transport rather than mocked Request objects.

- Correct HTTPS `APP_URL`, matching CORS origin and client-IP trust: form GET 200, valid-token POST 403 at the origin check. Approving the actual loopback tenant proxy still yields the same CSRF rejection.
- With the existing adapter: GET 200, POST reaches 422; path, query and email body remain intact.
- Missing/invalid tokens, missing cookie, different/missing/opaque/malformed Origin, an Origin list, wrong scheme/port and conflicting Host remain rejected.
- Forged `X-Forwarded-Proto`, `X-Forwarded-Host`, `Forwarded` and comma-separated forwarding claims do not authorize direct HTTP requests with a mismatched HTTPS Origin.
- Direct same-origin HTTP and native TLS continue to reach the handler. HTTP controls manually supply the cookie; they do not claim a browser sends a production Secure cookie over HTTP.
- A direct request to the adapter's backend with the configured Host, valid cookie/token and HTTPS Origin also reaches 422, even with no forwarding header. Thus the adapter's host check is not proof that the immediate sender is Render. Backend reachability is a deployment trust boundary.

There is a separate intentionally red counterexample on **each** target, expecting the legitimate no-adapter POST to reach 422. It fails with actual 403. It remains red; the adapter pass is not a framework passing-after fix. The repository characterization explicitly labels the 403 as a current limitation that a future approved contract must correct.

The **49 unchanged existing CSRF/job-retry unit tests pass**, 78 assertions; repository typecheck and focused Biome checks pass. Full coverage/E2E gates were not run: there is no runtime fix or publication in this local investigation. No assertions, skips or coverage thresholds were weakened.

Additional bounded observation: path-, userinfo- and fragment-bearing Origin strings normalize to the approved origin in the current URL parser and reach 422 with an already valid cookie/token. These are not browser-serialized Origin values, and no cross-site exploit was demonstrated. They are a recorded validation uncertainty/hardening item for the target-origin design, not a promise to accept malformed origins. Ordinary unparsable/list/opaque/hostile origins are separately tested and rejected.

External evidence: `/tmp/strata-csrf-proxy-20261024/` contains exact manifests/integrities, source comparison, final `*-transport-verified.log` files, deliberately red `*-expected-422-red.log` files, the syntax observation and unchanged-unit log. Initial fixture import/dependency and response-shape failures are retained separately; they are harness setup failures, not product regressions. No package contents were patched. The source/public-package tests import only exported entrypoints.

To run the repository characterization (Bun 1.4.4+, OpenSSL and the existing Chromium dependency required):

```sh
bun test tests/integration/csrfProxy.integration.test.ts
```

Use a clean synthetic environment or the repository's usual fixture setup. The recorded isolated commands do not load any private app configuration. This suite characterizes a limitation; passing it is not acceptance of a future proxy-origin fix.

## Resolution options requiring a contract decision

1. **Preferred narrow option: explicit CSRF target origin plus host admission.** Add an opt-in, validated application-owned target origin for CSRF and keep the current default for existing callers. It must preserve signed token/cookie and browser Origin checks, reject unknown/conflicting hosts and malformed source-origin syntax, and retain real direct-request controls. It should operate on origin policy without cloning native Requests or losing route params/cancellation. Do not implicitly reuse a CORS allowlist or silently reinterpret `APP_URL` for every existing application. The deployment must establish backend/ingress trust; selecting a configured origin is not evidence of a proxy peer. This is a proposed configuration contract, not an implemented option or removal instruction.
2. **Broader alternative: trusted proxy origin metadata for the HTTP stack.** Approve exact actual socket peers, validate singular forwarded authorities/schemes, require ingress overwrite and restricted backend reachability, and define interactions with tenant hosts, redirects and other origin consumers. Do not trust client-IP metadata as peer identity. This has a wider API/migration surface and requires a separate proposal before implementation.

The first approach follows OWASP's preference for a server-configured target origin, without general forwarding-header trust. Either option needs acceptance and a regression that changes the same no-adapter red case to handler reachability while retaining security controls. No new public API, environment variable or implicit origin trust was introduced here.

Native end-to-end TLS is demonstrated with the existing API, but is not a Render configuration-only fix: Render documents an HTTP upstream. Simply enabling native TLS on that backend is not a supported replacement for its edge behavior.

## App-agent adoption and private Render checks

**Now:** retain `src/http/publicOrigin.ts` and the wrapper in `src/modules/site/index.ts`. Keep `APP_URL` as the exact external HTTPS origin, `HOST=0.0.0.0`, production secrets/dev-header settings and all CSRF tests. Do not change the public origin to HTTP, mutate browser Origin, disable CSRF or broaden CORS as a workaround. A package upgrade to 2.2.56 does not permit adapter removal.

Before choosing or adopting a replacement, the app agent must privately verify:

1. Actual deployed revision/package versions, APP_ENV/NODE_ENV, exact canonical APP_URL, AUTH_DEV_HEADERS and any CORS overrides. The manifest/source alone do not prove these values.
2. Actual backend URL scheme/host/port, browser Origin, immediate socket-peer provenance and the edge's Host/forwarding-header preservation/overwrite behavior, including client-supplied conflicting headers. Record comparisons/booleans or sanitized metadata; never log tokens, cookies, secrets, request bodies or credential URLs.
3. Backend reachability from the public internet and other private-network services, and any bypass ingress/custom domain. Render's public load-balancer path alone does not establish trust for every internal path.
4. External GET/form/Set-Cookie, browser cookie exchange and invalid-input POST=422 without a provider call; missing/invalid/mismatched token, hostile/missing/null/malformed Origin and unexpected Host still denied. Exercise direct/internal traffic separately where reachable.

**Only after a replacement is implemented and demonstrated:** install its exact qualified package version, deliberately adopt its source/configuration wiring, and provide equivalent host admission before CSRF. Then replace the `requestAtPublicOrigin` wrapper with the qualified framework boundary and remove the import/helper only after no callers remain. Preserve and adapt the existing public-origin test assertions to the new boundary, adding the real proxy flow, direct-access and malformed/conflicting-input cases. Removing URL normalization while also removing its incidental Host rejection is not an equivalent adoption. Retain a known-good source/lockfile deployment for rollback; no database change or security weakening is part of this fix.

The app agent owns the eventual private hosted verification and deployment. This investigation changed no app files, live settings, database, mail or service. Shop adoption remains held for #257; the timer remains off. No commit, push, remote issue/PR, publication or deployment was performed.

## Primary external references

- [Render web services: TLS termination and port binding](https://render.com/docs/web-services#connecting-from-the-public-internet).
- [Render's HTTP-upstream deployment guidance](https://render.com/tutorials/web-service-vs-static-site/web-services).
- [OWASP CSRF prevention: determining target origin behind a proxy](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#identifying-the-target-origin).

## Accepted narrow contract: implementation follow-up

The human subsequently approved the narrow explicit target-origin contract and host admission, with TDD and real proxy tests. `CsrfOptions.targetOrigin` and `CSRF_TARGET_ORIGIN_CONFIG_KEY` provide that opt-in without inferring trust from APP_URL or forwarded headers. Root/generated providers bind the explicit environment value; existing app-owned providers require deliberate adoption. Runtime policy is validated during HttpKernel construction and captured for its web and cookie-API groups. Default callers retain their original behavior.

The original real-transport no-adapter regression failed 403 where 422 was required; the same regression passes with the explicit policy. Additional unit tests failed before the implementation for invalid configuration, host admission, strict source-origin syntax and kernel binding. Real native HTTP/HTTPS and Chromium tests retain the original controls and add direct middleware/kernel flows, native params/body/identity, malformed authorities and URL-shaped source origins. The installed generated-app verifier exercises the actual generated provider with no adapter, a browser form, hostile/missing-token/origin/host controls and invalid-policy startup refusal.

A second concrete defect surfaced in malformed wire Host testing: Bun can provide a relative request URL; HTML error negotiation then threw while formatting the admission error and replaced its 403 with 500. Three focused tests reproduce that formatter failure before the change. The minimal fallback selects JSON when URL metadata cannot be parsed, preserving the original mapped error; malformed requests are not normalized or admitted.

The new policy helper is included in the enforced coverage set. All existing HTTP exemptions remain identical, now listed explicitly rather than hidden by a broad glob. Historical scaffold hashes are unchanged; only declared literal import/binding/comment deltas extend the existing byte-reversible correction inventory. No old assertion, skip or coverage threshold is relaxed.

Candidate installed verification is evidence of the mechanism, not publication or a live Render check. Release/exact-published results must be reported from actual execution receipts. The external development evidence folder is `/tmp/strata-csrf-target-origin-20261024/`; original investigation logs remain at the previous path. The separate app remains read-only and its adapter must be adopted/replaced by its own agent after qualified-package installation and private ingress checks. The wider proxy-origin metadata API and breaking changes remain outside this implementation. Shop stays held for #257; the timer stays off.
