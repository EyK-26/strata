import { describe, expect, test } from "bun:test";
import { PayloadTooLargeError } from "@getstrata/core/errors/http";
import {
  createBodySizeLimitMiddleware,
  resolveMaxBodyBytes,
} from "@getstrata/core/http/bodySizeLimitMiddleware";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("bodySizeLimitMiddleware", () => {
  test("rejects requests above the configured limit", async () => {
    const middleware = createBodySizeLimitMiddleware(1024);
    const request = new Request("http://example.test/projects", {
      method: "POST",
      headers: { "content-length": "2048" },
    });

    const response = await middleware(request, async () => new Response("ok"));
    expect(response.status).toBe(new PayloadTooLargeError().status);
  });

  test("allows requests within the configured limit", async () => {
    const middleware = createBodySizeLimitMiddleware(1024);
    const request = new Request("http://example.test/projects", {
      method: "POST",
      headers: { "content-length": "512" },
    });

    const response = await middleware(request, async () => new Response("ok"));
    expect(response.status).toBe(200);
  });
  for (const method of ["text", "json", "arrayBuffer", "bytes", "blob"] as const) {
    test(`${method} rejects missing and deceptive content lengths`, async () => {
      for (const length of [undefined, "1", "garbage"]) {
        const request = new Request("http://example.test", {
          method: "POST",
          headers: length ? { "content-length": length } : {},
          body: JSON.stringify({ value: "x".repeat(64) }),
        });
        const response = await composeMiddleware(createBodySizeLimitMiddleware(8))(
          async (request) => {
            await request[method]();
            return new Response("accepted");
          },
        )(request);
        expect(response.status).toBe(413);
      }
    });
  }

  test("counts UTF-8 bytes and allows an exact-limit body", async () => {
    for (const [body, status] of [
      ["éé", 200],
      ["ééé", 413],
    ] as const) {
      const request = new Request("http://example.test", { method: "POST", body });
      const response = await composeMiddleware(createBodySizeLimitMiddleware(4))(
        async (request) => new Response(await request.text()),
      )(request);
      expect(response.status).toBe(status);
    }
  });

  test("preserves streaming, backpressure, cancellation and bodyUsed", async () => {
    let cancel = false;
    let received!: () => void;
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      received = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const request = new Request("http://example.test", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (reads++ === 0) controller.enqueue(new TextEncoder().encode("first"));
          else {
            await gate;
            controller.enqueue(new TextEncoder().encode("next"));
          }
        },
        cancel() {
          cancel = true;
        },
      }),
    });
    const pending = composeMiddleware(createBodySizeLimitMiddleware(16))(async (request) => {
      expect(request.bodyUsed).toBe(false);
      const reader = request.body?.getReader();
      if (!reader) throw new Error("Missing body");
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
      expect(request.bodyUsed).toBe(true);
      received();
      const cancelling = reader.cancel();
      release();
      await cancelling;
      return new Response("streamed");
    })(request);
    await first;
    release();
    expect(await (await pending).text()).toBe("streamed");
    expect(cancel).toBe(true);
  });

  test("direct reader and textStream cannot bypass the guard", async () => {
    for (const method of ["body", "textStream"] as const) {
      const request = new Request("http://example.test", { method: "POST", body: "oversized" });
      const response = await composeMiddleware(createBodySizeLimitMiddleware(4))(
        async (request) => {
          const reader =
            method === "body" ? request.body?.getReader() : request.textStream().getReader();
          if (!reader) throw new Error("Missing body");
          while (!(await reader.read()).done) {}
          return new Response("accepted");
        },
      )(request);
      expect(response.status).toBe(413);
    }
  });

  test("strictest nested middleware limit wins and consumed clones cannot be cloned again", async () => {
    const request = new Request("http://example.test", { method: "POST", body: "12345" });
    const response = await composeMiddleware(
      createBodySizeLimitMiddleware(16),
      createBodySizeLimitMiddleware(4),
      createBodySizeLimitMiddleware(32),
    )(async (request) => new Response(await request.text()))(request);
    expect(response.status).toBe(413);
    const valid = new Request("http://example.test", { method: "POST", body: "123" });
    await composeMiddleware(createBodySizeLimitMiddleware(4))(async (request) => {
      const clone = request.clone().clone();
      expect(await clone.text()).toBe("123");
      expect(await request.text()).toBe("123");
      expect(() => request.clone()).toThrow();
      return new Response("ok");
    })(valid);
  });

  test("invalid limits fail at construction and malformed environment values retain the default", () => {
    for (const limit of [0, -1, NaN, Infinity, 1.5])
      expect(() => createBodySizeLimitMiddleware(limit)).toThrow(RangeError);
    const previous = process.env.MAX_REQUEST_BODY_BYTES;
    try {
      process.env.MAX_REQUEST_BODY_BYTES = "8junk";
      expect(resolveMaxBodyBytes()).toBe(1_048_576);
      process.env.MAX_REQUEST_BODY_BYTES = "8";
      expect(resolveMaxBodyBytes()).toBe(8);
    } finally {
      restoreEnvVar("MAX_REQUEST_BODY_BYTES", previous);
    }
  });
});
