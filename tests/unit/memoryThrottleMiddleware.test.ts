import { describe, expect, test } from "bun:test";
import { createMemoryThrottleMiddleware } from "../../src/core/http/memoryThrottleMiddleware";

describe("createMemoryThrottleMiddleware", () => {
  test("allows requests until the attempt limit is exceeded", async () => {
    const middleware = createMemoryThrottleMiddleware({
      maxAttempts: 2,
      decaySeconds: 60,
      keyPrefix: "test-throttle-a:",
    });
    const next = async () => Response.json({ ok: true });
    const request = new Request("https://example.test/api/v1/resource");

    expect((await middleware(request, next)).status).toBe(200);
    expect((await middleware(request, next)).status).toBe(200);

    const blocked = await middleware(request, next);

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Too many requests." });
    expect(blocked.headers.get("retry-after")).toBe("60");
  });

  test("resets the bucket after the decay window", async () => {
    const middleware = createMemoryThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 0,
      keyPrefix: "test-throttle-b:",
    });
    const next = async () => Response.json({ ok: true });
    const request = new Request("https://example.test/api/v1/reset");

    expect((await middleware(request, next)).status).toBe(200);
    expect((await middleware(request, next)).status).toBe(200);
  });

  test("keys requests by forwarded ip, authorization header, or unknown", async () => {
    const middleware = createMemoryThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      keyPrefix: "test-throttle-c:",
    });
    const next = async () => Response.json({ ok: true });

    const forwardedRequest = new Request("https://example.test/api/v1/ip", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
    });
    const authRequest = new Request("https://example.test/api/v1/ip", {
      headers: { authorization: "Bearer secret-token-value" },
    });
    const unknownRequest = new Request("https://example.test/api/v1/ip");

    expect((await middleware(forwardedRequest, next)).status).toBe(200);
    expect((await middleware(authRequest, next)).status).toBe(200);
    expect((await middleware(unknownRequest, next)).status).toBe(200);

    expect((await middleware(forwardedRequest, next)).status).toBe(429);
    expect((await middleware(authRequest, next)).status).toBe(429);
    expect((await middleware(unknownRequest, next)).status).toBe(429);
  });

  test("uses the default key prefix when none is provided", async () => {
    const middleware = createMemoryThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
    });
    const next = async () => Response.json({ ok: true });
    const request = new Request("https://example.test/api/v1/default-prefix", {
      headers: { authorization: "Bearer default-prefix-token" },
    });

    expect((await middleware(request, next)).status).toBe(200);
    expect((await middleware(request, next)).status).toBe(429);
  });
});
