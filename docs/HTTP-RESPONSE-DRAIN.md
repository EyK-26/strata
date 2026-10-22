# HTTP response completion during shutdown

## Framework correction

An admitted request returning a `Response` finishes its application handler, but
does not establish that its response body finished writing. Bun's `stop(false)`
also resolves when a busy connection aborts. Previously Strata combined those two
events into a successful drain, then flushed and closed infrastructure even when
the response had been interrupted.

The compatible partial correction observes admitted request abort signals only
on listeners without a configured native WebSocket handler. If an
abort is observed after lifecycle shutdown starts, its drain handler fails after
waiting for both transport shutdown and outstanding application work. Existing
lifecycle policy then skips flush/close, invokes force handlers and returns an
unsuccessful result. This deliberately treats a peer disconnect during shutdown
as an unconfirmed response, regardless of whether the peer or runtime caused it.
It does not claim client consumption or durable delivery.

Disconnections observed before shutdown do not poison a later drain. Their
admitted application work must still finish before infrastructure closes. Requests
rejected by shutdown admission do not enter the response-abort observation path.
The server does not retain a collection of completed requests or replace native
file/stream responses with a framework transport implementation.

## Mixed HTTP/WebSocket limitation

Bun also aborts an upgraded request's native signal when its WebSocket closes
normally. This was reproduced for route and fallback upgrades, including handlers
that continue asynchronous work after upgrading. Observing those signals as HTTP
response failures would regress normal shutdown. The initial candidate was made
draft before merge when these additional checks failed; its earlier full green
gate is not acceptance of a corrected candidate.

The native API exposes no supported per-request completion/upgrade marker to this
adapter. The accepted compatible partial correction therefore retains existing
behavior for every listener configured with WebSocket support. Ordinary HTTP
responses on such mixed listeners still lack accurate abort-drain reporting.
This is an explicit remaining limitation, not fixed behavior. No request-header
heuristic, native-method patch, server proxy or implicit data envelope is used to
guess whether an upgrade succeeded. The accepted scope is the HTTP-only
correction, with this mixed-listener limitation retained explicitly.
The correction is included in the 2.2.50 source release. Published 2.2.49
remains unchanged and does not contain this correction. Registry consumers need
the qualified 2.2.50 packages to receive it.

## Separate upstream limitation: M1-DRAIN-1

On Bun 1.4.3, revision `c6da4a4d3010e5553438c60f6bd76d981976867c`, macOS arm64,
a second HTTP/1 request arriving while the first response is pending closes the
connection and can truncate the first response. A paused 64 MiB file transfer
reproduced this with raw `Bun.serve`, with and without `stop(false)`, and through
exact published Strata 2.2.49. Adding `Connection: close` did not prevent it.

The exact-revision upstream
[HTTP parser](https://github.com/oven-sh/bun/blob/c6da4a4d3010e5553438c60f6bd76d981976867c/packages/bun-uws/src/HttpContext.h#L480-L504)
deliberately closes Bun.serve connections on asynchronous pipelining while
`HTTP_RESPONSE_PENDING` is set. This occurs before dispatching the second request;
framework admission cannot intercept it. The separate node:http implementation
queues such requests, but replacing the framework server/SDK is not this fix.
Source inspection found the same Bun.serve branch in Bun 1.4.4 revision
`38afee6c84fcf48c0edb2466aa4b27d287a59c30`; that is not a runtime qualification of
1.4.4 or other operating systems.

The [documented graceful-stop contract](https://bun.com/reference/bun/Server/stop)
allows in-flight responses to complete. Accurate failure reporting fixes Strata's
false-success defect; it does **not** make the underlying truncated transfer
lossless. The original strict file-length/hash reproduction and failed receipts
remain unchanged. Native assets remain deferred to the major-version design;
no same-listener passthrough, proxy, retry, package patch or new public-assets API
is introduced. Shop adoption remains held for #257; no relationship between this
HTTP finding and that separate qualification hold has been established.

## Regression evidence

`tests/integration/httpResponseDrain.integration.test.ts` exercises real TCP
connections through registered routes and fallback dispatch. Normal transfers
must contain all 67,108,864 bytes and the exact SHA-256
`103f23a15401a701b73587902f16e3b5b3bf38a039d5c94b675a9a8e84dbd5b5`.
Pipelined or disconnected transfers must not report successful drain if their
body is incomplete. A future runtime that completes the pipelined response must
pass the same full-body check and successful-drain assertions. Separate tests
prove that disconnected application work still runs to completion, distinguishing
abort observations before shutdown from those during shutdown.

The initial six-case regression produced two normal-transfer passes and four
false-success failures before the correction. The additional characterization
does not replace the stricter, still-red upstream lossless-transfer reproduction.
Four additional upgrade regressions preserve normal close code 1000 and wait for
upgraded request business work, through both route and fallback dispatch. The
HTTP-only partial option passes 33 focused tests, including all prior assertions.
Existing lifecycle, admission, transaction and coverage assertions remain intact.
