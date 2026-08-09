import { describe, expect, test } from "bun:test";
import { PayloadTooLargeError } from "../../src/core/errors/http";
import { createBodySizeLimitMiddleware } from "../../src/core/http/bodySizeLimitMiddleware";

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
});
