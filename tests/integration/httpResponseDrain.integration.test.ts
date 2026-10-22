import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import type { Server } from "bun";

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("HTTP drain fixture deadline")), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const dispatch of ["route", "fallback"] as const) {
  for (const peer of ["reading", "pipeline", "disconnect"] as const) {
    test(`${dispatch}: shutdown distinguishes a completed file from an interrupted response (${peer})`, async () => {
      const root = await mkdtemp(join(tmpdir(), "strata-response-drain-"));
      const file = join(root, "large.bin");
      const bytes = Buffer.alloc(64 * 1024 * 1024, 90);
      const expectedHash = createHash("sha256").update(bytes).digest("hex");
      await writeFile(file, bytes);
      const lifecycle = new LifecycleCoordinator({ timeoutMs: 3000 });
      const phases: string[] = [];
      let admissions = 0;
      const handler = () => new Response(Bun.file(file));
      const server = createWebServer({
        port: 0,
        native: { hostname: "127.0.0.1" },
        lifecycle,
        onRequest: () => {
          admissions++;
        },
        ...(dispatch === "route" ? { routes: { "/large": handler } } : { handle: handler }),
      });
      lifecycle.register(
        "telemetry",
        () => {
          phases.push("flush");
        },
        "flush",
      );
      lifecycle.register(
        "database",
        () => {
          phases.push("close");
        },
        "close",
      );
      const socket = connect(Number(server.port), "127.0.0.1");
      let ready!: () => void;
      const headersReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let close!: () => void;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      socket.on("close", close);
      socket.on("error", () => {});
      socket.on("connect", () => {
        socket.write("GET /large HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n");
      });
      let headers = Buffer.alloc(0);
      let bodyStarted = false;
      let received = 0;
      const hash = createHash("sha256");
      socket.on("data", (input: Buffer) => {
        let data = input;
        if (!bodyStarted) {
          headers = Buffer.concat([headers, data]);
          const boundary = headers.indexOf("\r\n\r\n");
          if (boundary < 0) return;
          bodyStarted = true;
          data = headers.subarray(boundary + 4);
          headers = headers.subarray(0, boundary + 4);
          socket.pause();
          ready();
        }
        received += data.length;
        hash.update(data);
      });
      try {
        await bounded(headersReady);
        expect(Number(headers.toString().match(/^content-length:\s*(\d+)\s*$/im)?.[1])).toBe(
          bytes.length,
        );
        const shutdown = lifecycle.shutdown("HTTP_RESPONSE_DRAIN_TEST");
        if (peer === "pipeline") {
          socket.write("GET /after HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n");
        }
        await Bun.sleep(30);
        if (peer === "disconnect") socket.destroy();
        else socket.resume();
        await bounded(closed);
        const result = await bounded(shutdown);
        const complete = received === bytes.length && hash.digest("hex") === expectedHash;
        expect(admissions).toBe(1);
        expect(result.timedOut).toBe(false);
        if (peer === "reading") {
          expect(received).toBe(bytes.length);
          expect(complete).toBe(true);
        }
        // A runtime that safely drains/rejects pipelining may deliver the complete file.
        // Otherwise an aborted transfer must never be reported as a successful drain.
        expect(result.successful).toBe(complete);
        if (complete) {
          expect(result.errors).toEqual([]);
          expect(phases).toEqual(["flush", "close"]);
        } else {
          expect(phases).toEqual([]);
          expect(result.errors).toHaveLength(1);
          expect(result.errors[0]?.phase).toBe("drain");
          expect(String(result.errors[0]?.error)).toContain("aborted during shutdown");
        }
      } finally {
        socket.destroy();
        await server.stop(true);
        await rm(root, { recursive: true });
      }
    }, 10_000);
  }
}

for (const timing of ["before", "during"] as const) {
  test(`disconnection ${timing} shutdown still waits for admitted business work`, async () => {
    const lifecycle = new LifecycleCoordinator({ timeoutMs: 3000 });
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aborted!: () => void;
    const observedAbort = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const order: string[] = [];
    const server = createWebServer({
      port: 0,
      native: { hostname: "127.0.0.1" },
      lifecycle,
      handle: async (request) => {
        request.signal.addEventListener("abort", aborted, { once: true });
        enter();
        await gate;
        order.push("work");
        return new Response("finished");
      },
    });
    lifecycle.register(
      "telemetry",
      () => {
        order.push("flush");
      },
      "flush",
    );
    lifecycle.register(
      "database",
      () => {
        order.push("close");
      },
      "close",
    );
    const controller = new AbortController();
    const response = fetch(server.url, { signal: controller.signal }).catch(() => undefined);
    try {
      await bounded(entered);
      if (timing === "before") {
        controller.abort();
        await bounded(observedAbort);
      }
      const shutdown = lifecycle.shutdown("DISCONNECTED_BUSINESS_WORK");
      if (timing === "during") {
        controller.abort();
        await bounded(observedAbort);
      }
      let settled = false;
      void shutdown.then(() => {
        settled = true;
      });
      await Bun.sleep(20);
      expect(settled).toBe(false);
      expect(order).toEqual([]);
      release();
      const result = await bounded(shutdown);
      expect(result.successful).toBe(timing === "before");
      expect(result.timedOut).toBe(false);
      expect(order).toEqual(timing === "before" ? ["work", "flush", "close"] : ["work"]);
    } finally {
      release();
      controller.abort();
      await response;
      await server.stop(true);
    }
  }, 10_000);
}

for (const dispatch of ["route", "fallback"] as const) {
  for (const delayedHandler of [false, true]) {
    test(`${dispatch}: normal WebSocket shutdown preserves upgraded request work (delayed=${delayedHandler})`, async () => {
      const lifecycle = new LifecycleCoordinator({ timeoutMs: 3000 });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let socketClosed!: () => void;
      const closed = new Promise<void>((resolve) => {
        socketClosed = resolve;
      });
      let serverCloseCode: number | undefined;
      let infrastructureClosed = false;
      const handler = async (request: Request, server: Server<undefined>) => {
        if (!server.upgrade(request)) return new Response("Upgrade required", { status: 400 });
        if (delayedHandler) await gate;
        return undefined;
      };
      const server = createWebServer<undefined>({
        port: 0,
        lifecycle,
        native: {
          hostname: "127.0.0.1",
          websocket: {
            message() {},
            close(_socket, code) {
              serverCloseCode = code;
              socketClosed();
            },
          },
        },
        ...(dispatch === "route" ? { routes: { "/": handler } } : { handle: handler }),
      });
      lifecycle.register(
        "infrastructure",
        () => {
          infrastructureClosed = true;
        },
        "close",
      );
      const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const opened = new Promise<void>((resolve, reject) => {
        client.onopen = () => resolve();
        client.onerror = () => reject(new Error("WebSocket fixture failed to connect"));
      });
      try {
        await bounded(opened);
        const shutdown = lifecycle.shutdown("NORMAL_WEBSOCKET_CLOSE");
        await Bun.sleep(20);
        expect(infrastructureClosed).toBe(false);
        client.close(1000, "finished");
        await bounded(closed);
        if (delayedHandler) {
          await Bun.sleep(20);
          expect(infrastructureClosed).toBe(false);
        }
        release();
        const result = await bounded(shutdown);
        expect(result.successful).toBe(true);
        expect(result.timedOut).toBe(false);
        expect(result.errors).toEqual([]);
        expect(serverCloseCode).toBe(1000);
        expect(infrastructureClosed).toBe(true);
      } finally {
        release();
        client.close();
        await server.stop(true);
      }
    }, 10_000);
  }
}
