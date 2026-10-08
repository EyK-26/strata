import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { createBodySizeLimitMiddleware } from "@getstrata/core/http/bodySizeLimitMiddleware";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";

function streamed(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

describe("native HTTP controls and streaming consumption limits", () => {
  test("onRequest covers native routes, preflight, fallback and assets exactly once and can reject", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "strata-http-"));
    await mkdir(join(publicDir, "assets"));
    await Bun.write(join(publicDir, "assets", "test.txt"), "asset");
    const calls: string[] = [];
    let handlers = 0;
    const server = createWebServer({
      port: 0,
      publicDir,
      native: { hostname: "127.0.0.1", idleTimeout: 2, development: false },
      onRequest(request, native) {
        calls.push(`${request.method} ${new URL(request.url).pathname}`);
        expect(native.requestIP(request)?.address).toBe("127.0.0.1");
        if (request.headers.has("x-reject")) return new Response("rejected", { status: 429 });
      },
      routes: {
        "/things/:id": {
          POST: (request: Request) => {
            handlers++;
            return Response.json({
              template: currentRequestMeta().routeTemplate,
              id: Reflect.get(request, "params").id,
            });
          },
        },
      },
      handle() {
        handlers++;
        return new Response("fallback");
      },
    });
    try {
      const base = server.url;
      expect(await (await fetch(new URL("/things/12", base), { method: "POST" })).json()).toEqual({
        template: "/things/:id",
        id: "12",
      });
      expect(
        (
          await fetch(new URL("/things/12", base), {
            method: "OPTIONS",
            headers: { origin: "https://example.test", "access-control-request-method": "POST" },
          })
        ).status,
      ).toBe(204);
      expect(await (await fetch(new URL("/fallback", base))).text()).toBe("fallback");
      expect(await (await fetch(new URL("/assets/test.txt", base))).text()).toBe("asset");
      expect(
        (await fetch(new URL("/things/12", base), { method: "POST", headers: { "x-reject": "1" } }))
          .status,
      ).toBe(429);
      expect(handlers).toBe(2);
      expect(calls).toEqual([
        "POST /things/12",
        "OPTIONS /things/12",
        "GET /fallback",
        "GET /assets/test.txt",
        "POST /things/12",
      ]);
    } finally {
      server.stop(true);
      await rm(publicDir, { recursive: true, force: true });
    }
  });

  test("Bun transport rejects oversized streamed requests on native and fallback dispatch", async () => {
    const server = createWebServer({
      port: 0,
      native: { maxRequestBodySize: 8, development: false },
      routes: {
        "/native": { POST: async (request: Request) => new Response(await request.text()) },
      },
      handle: async (request) => new Response(await request.text()),
    });
    try {
      for (const path of ["/native", "/fallback"]) {
        const response = await fetch(new URL(path, server.url), {
          method: "POST",
          body: streamed("x".repeat(64)),
        });
        expect(response.status).toBe(413);
        await response.text();
      }
    } finally {
      server.stop(true);
    }
  });

  test("middleware enforces a stricter streaming limit and preserves native request params and identity", async () => {
    let validIdentity = false;
    const server = createWebServer({
      port: 0,
      native: { maxRequestBodySize: 4096 },
      routes: {
        "/upload/:id": {
          POST: composeMiddleware(createBodySizeLimitMiddleware(8))(async (request) => {
            validIdentity = server.requestIP(request) !== null;
            expect(Reflect.get(request, "params").id).toBe("12");
            return new Response(await request.text());
          }),
        },
      },
    });
    try {
      expect(
        (
          await fetch(new URL("/upload/12", server.url), {
            method: "POST",
            body: streamed("x".repeat(64)),
          })
        ).status,
      ).toBe(413);
      const within = await fetch(new URL("/upload/12", server.url), {
        method: "POST",
        body: streamed("eight!!!"),
      });
      expect(within.status).toBe(200);
      expect(await within.text()).toBe("eight!!!");
      expect(validIdentity).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("multipart and cloned JSON bodies obey limits", async () => {
    const server = createWebServer({
      port: 0,
      native: { maxRequestBodySize: 4096 },
      routes: {
        "/json": {
          POST: composeMiddleware(createBodySizeLimitMiddleware(16))(async (request) => {
            const data = await request.clone().json();
            return Response.json({ data, original: await request.json() });
          }),
        },
        "/form": {
          POST: composeMiddleware(createBodySizeLimitMiddleware(512))(
            async (request) => new Response(String((await request.formData()).get("name"))),
          ),
        },
      },
    });
    try {
      const response = await fetch(new URL("/json", server.url), {
        method: "POST",
        body: streamed('{"ok":true}'),
      });
      expect(await response.json()).toEqual({ data: { ok: true }, original: { ok: true } });
      expect(
        (
          await fetch(new URL("/json", server.url), {
            method: "POST",
            body: streamed(JSON.stringify({ name: "x".repeat(100) })),
          })
        ).status,
      ).toBe(413);
      const small = new FormData();
      small.set("name", "valid");
      expect(
        await (await fetch(new URL("/form", server.url), { method: "POST", body: small })).text(),
      ).toBe("valid");
      const large = new FormData();
      large.set("name", "x".repeat(1000));
      // Stream the encoded multipart body so no Content-Length fast path is involved.
      const encoded = new Request("http://example.test", { method: "POST", body: large });
      expect(
        (
          await fetch(new URL("/form", server.url), {
            method: "POST",
            headers: encoded.headers,
            body: encoded.body,
          })
        ).status,
      ).toBe(413);
    } finally {
      server.stop(true);
    }
  });

  test("typed WebSocket data and native upgrade remain accessible", async () => {
    let hooks = 0;
    const server = createWebServer<{ prefix: string }>({
      port: 0,
      native: {
        websocket: {
          message(socket, message) {
            socket.send(socket.data.prefix + message);
          },
        },
      },
      onRequest() {
        hooks++;
      },
      handle(request, native) {
        if (native.upgrade(request, { data: { prefix: "echo:" } })) return undefined;
        return new Response("upgrade failed", { status: 400 });
      },
    });
    const socket = new WebSocket(new URL(server.url).href.replace("http:", "ws:"));
    try {
      const echoed = await new Promise<string>((resolve, reject) => {
        socket.onopen = () => socket.send("hello");
        socket.onmessage = (event) => resolve(String(event.data));
        socket.onerror = () => reject(new Error("WebSocket failed"));
      });
      expect(echoed).toBe("echo:hello");
      expect(hooks).toBe(1);
    } finally {
      socket.close();
      server.stop(true);
    }
  });

  test("client cancellation reaches the native request signal while streaming", async () => {
    let admitted!: () => void;
    let aborted!: () => void;
    const ready = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const server = createWebServer({
      port: 0,
      native: { idleTimeout: 2 },
      handle: composeMiddleware(createBodySizeLimitMiddleware(1024))(async (request) => {
        request.signal.addEventListener("abort", aborted, { once: true });
        admitted();
        try {
          await request.text();
        } catch {
          return new Response("cancelled", { status: 499 });
        }
        return new Response("done");
      }),
    });
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode("partial"));
      },
    });
    try {
      const pending = fetch(server.url, { method: "POST", body, signal: controller.signal }).catch(
        (error) => error,
      );
      await ready;
      controller.abort();
      expect(await pending).toBeInstanceOf(Error);
      await Promise.race([
        cancelled,
        Bun.sleep(2000).then(() => {
          throw new Error("Missing native request cancellation");
        }),
      ]);
    } finally {
      controller.abort();
      server.stop(true);
    }
  });

  test("TLS configuration reaches Bun without replacing framework routing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-tls-"));
    const key = join(directory, "key.pem");
    const cert = join(directory, "cert.pem");
    const certificate = Bun.spawn(
      [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        "/CN=localhost",
        "-days",
        "1",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    let server: ReturnType<typeof createWebServer> | undefined;
    try {
      expect(await certificate.exited).toBe(0);
      server = createWebServer({
        port: 0,
        native: { hostname: "127.0.0.1", tls: { key: Bun.file(key), cert: Bun.file(cert) } },
        routes: { "/secure": () => new Response("secure") },
      });
      const response = await fetch(new URL("/secure", server.url), {
        tls: { rejectUnauthorized: false },
      });
      expect(await response.text()).toBe("secure");
    } finally {
      server?.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });

  (process.platform === "linux" ? test : test.skip)(
    "Linux reusePort remains available to multiple framework servers",
    async () => {
      const first = createWebServer({
        port: 0,
        native: { hostname: "127.0.0.1", reusePort: true },
        routes: { "/ready": () => new Response("first") },
      });
      let second: ReturnType<typeof createWebServer> | undefined;
      try {
        const port = first.port;
        if (port === undefined) throw new Error("Expected TCP port");
        second = createWebServer({
          port,
          native: { hostname: "127.0.0.1", reusePort: true },
          routes: { "/ready": () => new Response("second") },
        });
        const response = await fetch(new URL("/ready", first.url));
        expect(["first", "second"]).toContain(await response.text());
      } finally {
        second?.stop(true);
        first.stop(true);
      }
    },
  );

  test("native handler ownership is protected for JavaScript/config-spread callers", () => {
    for (const field of ["fetch", "routes", "port", "unix"]) {
      expect(() =>
        createWebServer({ port: 0, native: { [field]: () => new Response("bad") } }),
      ).toThrow("owned by createWebServer");
    }
    expect(() => createWebServer({ port: 0, native: { maxRequestBodySize: 0 } })).toThrow(
      RangeError,
    );
  });
});
