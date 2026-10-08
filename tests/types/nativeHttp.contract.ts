/** Compiled against source and packed bootstrap by the generated-app matrix. */
import type { NativeServerOptions } from "@getstrata/bootstrap";
import { createWebServer, type WebServerOptions } from "@getstrata/bootstrap/web/server";
import type { Server } from "bun";

export function nativeHttpContract(): void {
  const native: NativeServerOptions<{ userId: number }> = {
    hostname: "127.0.0.1",
    idleTimeout: 30,
    reusePort: true,
    maxRequestBodySize: 1_048_576,
    development: false,
    tls: { key: "test-only-key", cert: "test-only-cert" },
    websocket: {
      message(socket, message) {
        const id: number = socket.data.userId;
        socket.send(`${id}:${message}`);
        // @ts-expect-error WebSocket data retains the application's declared type.
        const wrong: string = socket.data.userId;
        void wrong;
      },
    },
  };
  const options: WebServerOptions<{ userId: number }> = {
    port: 0,
    native,
    onRequest(request, server) {
      server.timeout(request, 0);
    },
    handle(request, server) {
      if (server.upgrade(request, { data: { userId: 1 } })) return undefined;
      return new Response("not upgraded");
    },
  };
  const server: Server<{ userId: number }> = createWebServer(options);
  void server;
  // @ts-expect-error Native configuration cannot replace framework fetch dispatch.
  const badFetch: NativeServerOptions = { fetch: () => new Response("bypass") };
  // @ts-expect-error Native routes cannot bypass framework hook composition.
  const badRoutes: NativeServerOptions = { routes: {} };
  // @ts-expect-error Port is owned by the framework's explicit option.
  const badPort: NativeServerOptions = { port: 3000 };
  // @ts-expect-error Bun idleTimeout is numeric.
  const badTimeout: NativeServerOptions = { idleTimeout: "30" };
  void badFetch;
  void badRoutes;
  void badPort;
  void badTimeout;
}
