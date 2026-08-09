import { describe, expect, test } from "bun:test";
import { createScimThrottleMiddleware } from "@getstrata/core/http/scimThrottleMiddleware";

describe("createScimThrottleMiddleware", () => {
  test("throttles in memory when Redis is not configured", async () => {
    const middleware = createScimThrottleMiddleware({
      maxAttempts: 2,
      decaySeconds: 60,
    });
    const next = async () => Response.json({ ok: true });
    const request = new Request("http://example.test/scim/v2/Users", {
      headers: { authorization: "Bearer scim-memory-throttle-token" },
    });

    expect((await middleware(request, next)).status).toBe(200);
    expect((await middleware(request, next)).status).toBe(200);

    const blocked = await middleware(request, next);

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Too many SCIM requests." });
    expect(blocked.headers.get("retry-after")).toBe("60");
  });

  test("keeps separate memory buckets per authorization prefix", async () => {
    const middleware = createScimThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
    });
    const next = async () => Response.json({ ok: true });
    const first = new Request("http://example.test/scim/v2/Users", {
      headers: { authorization: "Bearer scim-bucket-one-token" },
    });
    const second = new Request("http://example.test/scim/v2/Users", {
      headers: { authorization: "Bearer scim-bucket-two-token" },
    });

    expect((await middleware(first, next)).status).toBe(200);
    expect((await middleware(second, next)).status).toBe(200);
    expect((await middleware(first, next)).status).toBe(429);
    expect((await middleware(second, next)).status).toBe(429);
  });
});
