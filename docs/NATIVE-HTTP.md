# Native Bun HTTP configuration and request limits

`createWebServer` keeps Strata's native route conversion, CORS preflights, request metadata, public assets and fallback handler composition. Its `native` option exposes Bun's typed TCP server configuration, including hostname, TLS, idleTimeout, reusePort, development, id, error and WebSocket handlers. Port remains the top-level option. `fetch`, `routes`, `port` and `unix` inside `native` are rejected at runtime as well as excluded from its type. This API does not expose Unix-domain listening; it requires a TCP port.

```ts
import { createWebServer } from "@getstrata/bootstrap/web/server";

const server = createWebServer<{ userId: number }>({
  port: 3000,
  native: {
    hostname: "0.0.0.0",
    idleTimeout: 30,
    maxRequestBodySize: 1_048_576,
    development: false,
    websocket: {
      message(socket, message) {
        socket.send(`${socket.data.userId}:${message}`);
      },
    },
  },
  onRequest(request, nativeServer) {
    // Runs once on native routes, synthesized preflights, assets and fallback.
    // Returning a Response short-circuits dispatch.
    if (request.headers.has("x-maintenance"))
      return new Response("Unavailable", { status: 503 });
    nativeServer.timeout(request, 30);
  },
  handle(request, nativeServer) {
    // Authenticate/authorize and validate origins in the application first.
    if (new URL(request.url).pathname === "/socket") {
      if (nativeServer.upgrade(request, { data: { userId: 1 } })) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    }
    return new Response("Hello");
  },
});
```

`handle(request, server)` receives the actual Bun server. With a WebSocket handler configured, `undefined` preserves Bun's successful-upgrade contract; return `null` for the framework HTML 404. Existing one-argument handlers remain compatible. WebSocket upgrades belong in the fallback `handle`; application native route maps retain their existing Response/HTML-404 contract. Native `error` uses Bun's error-handler contract. Experimental controls inherited from Bun's types are not independently qualified by Strata.

`onRequest` now covers native registered routes as well as fallback/asset requests, with socket metadata already installed and route templates available for native dispatch. Explicit OPTIONS and synthesized CORS preflights also run the hook once. Bun transport rejection before dispatch cannot execute this hook. This corrects the previous native-route omission; audit existing hooks for unintended duplicated business work. A hook is not a substitute for authentication, tenant resolution or CORS policy.

## Actual body limits

The default transport ceiling is `MAX_REQUEST_BODY_BYTES`, or 1 MiB when unset/invalid, matching the framework middleware default. Explicit `native.maxRequestBodySize` overrides that transport ceiling and must be a positive safe integer. Unlike the previous server default, this ceiling applies to native routes, fallback and uploads, including streamed/chunked bodies without Content-Length. Configure a larger ceiling deliberately for large uploads, and set the applicable middleware/environment limit consistently. The smallest applicable limit wins.

`createBodySizeLimitMiddleware(maxBytes)` keeps its JSON 413 contract, rejects excessive declared lengths early, and also counts actual UTF-8 bytes as the body is consumed. Missing or deceptive length headers do not bypass it. It delegates body reads through a bounded stream without collecting the whole body, preserving the original native request identity, params, cookies, signal, streaming and cancellation. Normal `text`, `json`, `formData`, `arrayBuffer`, `blob`, `bytes`, `textStream`, direct `body` readers and guarded clones share that limit. `bodyUsed` and clone-after-consumption behavior follow the bounded body. Multiple guards preserve the strictest limit.

The guard owns that individual request's consumption methods/body getters; it does not modify global prototypes. Low-level callers should use the request's normal methods rather than calling Request prototype methods directly. Cloned bodies preserve params/cookies access; a clone is a Request copy, not a socket handle for server controls. Cookie access on a guarded clone shares the native cookie map. Framework CSRF and login parsing remain supported.

Bun transport rejection uses Bun's own HTTP 413 response; callers must not require a JSON body for a rejection that occurs before framework dispatch. A framework consumption guard returns JSON 413 when its handler is still awaiting body consumption. If a handler returns a streaming response before consumption finishes, a later overflow errors that stream; HTTP headers already sent cannot be changed. Validate required input before business writes or returning success. HTTP framing (including conflicting/malformed lengths and extra bytes) remains Bun's responsibility.

Request cancellation remains the native `request.signal`; pass it to cancellable provider operations. Source cancellation and stream errors propagate through the guard. No eager whole-body buffering or implicit cancellation of a returned response stream is added. Lifecycle draining and hard shutdown deadlines are the next independent framework change.

Runtime tests cover real native/fallback requests, chunked overflow, multipart, cloned JSON, cancellation, TLS and typed WebSocket upgrades on Bun 1.4.2. Linux CI additionally exercises two servers sharing a reusePort socket; this is not a cross-platform promise. Public type fixtures run against packed/generated applications on the existing TypeScript matrix. See [Bun server configuration](https://bun.sh/docs/runtime/http/server) and [WebSockets](https://bun.sh/docs/runtime/http/websockets) for native behavior.
