# Public artifact origin: native static-engine feasibility

The M1 design target is an explicit public artifact origin. This bounded check
uses a separate native Nginx process for selected public build outputs. It adds
an opt-in probe and evidence, without a framework adapter, publisher, deployment
or new public API. Application documents, private downloads, authentication and
ORM work retain their guarded application owners.

## Actual result

The local reference engine was Nginx 1.30.6, from this immutable official image:

```text
nginx@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951
```

Bun 1.4.3 produced the two small JavaScript entries through its native build API.
The probe served those outputs unchanged from distinct build-A/build-B paths.
It also used a synthetic 64 MiB binary fixture, matching the original Bun
length/hash reproduction's size and bytes.

All five registered cases passed:

- One protocol/control group: exact GET bytes, JavaScript MIME, public CORS
  headers without credentials permission, no Set-Cookie, nosniff, immutable cache
  headers, ETag/304, HEAD byte count,
  range/206, unsatisfiable range/416, missing paths/404, UTF-8 filenames/content,
  symlink denial without target bytes, and retained old/new build paths.
  Seven filename controls preserve UTF-8, percent literals, encoded-looking
  separators/dots, hash/query characters, plus and outer spaces. A request for the
  actual mounted `/fixture.conf` returns 404 without serving configuration bytes.
- Two independent single-response transfers and two pipelined transfers. Each
  paused its client after headers, initiated native `QUIT` while the body was
  incomplete, verified the engine remained alive, resumed the client and required
  all 67,108,864 bytes plus the exact SHA-256 digest before successful engine exit.
  A pipelined request sent after shutdown began produced no later response in
  these runs; the asserted guarantee is completion of the first admitted body.

The [sanitized receipt](qualification/public-static-engine-2026-10-23.json)
records the actual image/runtime, native-entry hashes, each transfer's exact
digest, probe/raw-receipt hashes and cleanup. These are five local feasibility
cases, separate from the published framework qualification profiles.

## Engine and fixture boundaries

Nginx owns file delivery, HTTP ranges and native graceful shutdown. Its documented
[`QUIT` control](https://nginx.org/en/docs/control.html) supplies the shutdown
mechanism; this probe does not emulate a server in TypeScript. The raw client
measures the declared response length and bytes independently of the engine.
The [native static configuration](https://nginx.org/en/docs/http/ngx_http_core_module.html)
uses `try_files` and `disable_symlinks`, with explicit per-location headers.

The fixture records a fresh UUID owner before Docker create, binds an ephemeral
host port explicitly to 127.0.0.1 and mounts only its selected public directory
and configuration, read-only. The container runs as the image's unprivileged
Nginx user with dropped capabilities, a read-only root and private temporary
filesystems. No application checkout, upload directory, credentials or Docker
socket is mounted. Ownership labels are verified before removal. All six created
containers and scratch inputs were removed; every captured SQL/Docker resource
field returned to baseline. The pulled image remains a recorded local cache.

The first attempt stopped at Docker create because its host bind path used the
noncanonical `/tmp` symlink. Resolving the fresh evidence directory through the
native filesystem corrected fixture preparation. No case executed in that
attempt; its failure and cleanup receipt remain retained. No assertion was removed
or weakened after the failure.

## What remains open

This is a reference-engine result, not selection or deployment of a production
provider. It does not qualify HTTPS, a CDN/object-store SDK, real generated
HTMX/SPA/hybrid clients, parent-domain cookies, cached browser upgrades, a manifest
or view API, or an operational retention/rollback policy. The fixture's one-year
immutable header and retained A/B files are controls, not an accepted production
retention window. A public origin cannot replace guarded private downloads.
The provider filename controls also do not silently change the proposed manifest
input restrictions. Whether a future resolver accepts those raw names or limits
native output naming remains a concrete API/policy review decision.

The [native browser/integrity findings](PUBLIC-ARTIFACT-INTEGRITY.md) remain:
native HTML omitted integrity, and entry SRI did not protect an altered dynamic
import. Static delivery alone does not enforce browser integrity over a module
graph. Exact document ownership and promised integrity scope still need review.

The original strict Bun asynchronous-pipeline failure remains unchanged and red.
This separate engine's success does not establish lossless Bun delivery or correct
mixed HTTP/WebSocket abort reporting. All 26 frozen original plan/M0/M1/M2 files
were checked byte-identical. Native assets remain in the reviewed major-version
design; no breaking implementation is included. Shop adoption stays held for #257
and the timer remains off.

## Reproduce

Pull the official image once, inspect its actual RepoDigest and pass that immutable
reference to a new evidence directory:

```sh
docker pull nginx:stable-alpine
docker image inspect nginx:stable-alpine --format '{{json .RepoDigests}}'
bun scripts/characterize-public-static-engine.ts /tmp/strata-static-new-run nginx@sha256:<actual-digest>
```

The probe refuses an existing directory and requires an already available exact
image. Run it sequentially with native/full validation. Retain its raw receipt,
logs and engine version, then compare fresh before/after resource inventories.
Repeat qualification for any selected runtime, image or configuration change.
