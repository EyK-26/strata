import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import {
  createMemoryThrottleMiddleware,
  resetMemoryThrottleForTests,
} from "@getstrata/core/http/memoryThrottleMiddleware";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import { restoreEnvVar } from "../helpers/restoreEnv";

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

  test("keys trusted forwarded IP or authenticated identity; forged bearer values share the guest bucket", async () => {
    const previous = process.env.TRUST_FORWARDED_FOR;
    process.env.TRUST_FORWARDED_FOR = "true";

    try {
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
      expect((await middleware(unknownRequest, next)).status).toBe(429);

      expect((await middleware(forwardedRequest, next)).status).toBe(429);
      expect((await middleware(authRequest, next)).status).toBe(429);
      expect((await middleware(unknownRequest, next)).status).toBe(429);
    } finally {
      restoreEnvVar("TRUST_FORWARDED_FOR", previous);
    }
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

  test("isolates buckets per middleware instance", async () => {
    const first = createMemoryThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      keyPrefix: "test-throttle-isolated:",
    });
    const second = createMemoryThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      keyPrefix: "test-throttle-isolated:",
    });
    const next = async () => Response.json({ ok: true });
    const request = new Request("https://example.test/api/v1/isolated");

    expect((await first(request, next)).status).toBe(200);
    expect((await first(request, next)).status).toBe(429);
    expect((await second(request, next)).status).toBe(200);
  });

  test("resetMemoryThrottleForTests clears buckets on existing middleware", async () => {
    const middleware = createMemoryThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      keyPrefix: "test-throttle-reset:",
    });
    const next = async () => Response.json({ ok: true });
    const request = new Request("https://example.test/api/v1/reset-seams");

    expect((await middleware(request, next)).status).toBe(200);
    expect((await middleware(request, next)).status).toBe(429);

    resetMemoryThrottleForTests();

    expect((await middleware(request, next)).status).toBe(200);
  });

  test("returns an HTML 429 when the request prefers HTML views", async () => {
    const previous = process.env.FRONTEND_MODE;
    process.env.FRONTEND_MODE = "server-htmx";

    try {
      const middleware = createMemoryThrottleMiddleware({
        maxAttempts: 1,
        decaySeconds: 60,
        keyPrefix: "test-throttle-html:",
      });
      const next = async () => Response.json({ ok: true });
      const request = new Request("https://example.test/login", {
        headers: { accept: "text/html" },
      });

      expect((await middleware(request, next)).status).toBe(200);

      const blocked = await middleware(request, next);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("content-type")).toContain("text/html");
      expect(await blocked.text()).toContain("Too many requests.");
      expect(blocked.headers.get("retry-after")).toBe("60");
    } finally {
      restoreEnvVar("FRONTEND_MODE", previous);
    }
  });
});

describe("bounded middleware admission", () => {
  test("concurrent admissions enforce one fixed window without counter races", async () => {
    const middleware = createMemoryThrottleMiddleware({ maxAttempts: 7, decaySeconds: 60 });
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        middleware(
          new Request("https://example.test/a", { headers: { accept: "application/json" } }),
          async () => {
            await Promise.resolve();
            return new Response("ok");
          },
        ),
      ),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(7);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(93);
    expect(middleware.stats().retainedBuckets).toBe(1);
    middleware.dispose();
  });

  test("registered templates, method, tenant and verified token identities determine local buckets", async () => {
    const middleware = createMemoryThrottleMiddleware({ maxAttempts: 1, decaySeconds: 60 });
    const next = async () => new Response("ok");
    const invoke = (
      id: number,
      token: number,
      method = "GET",
      path = "a",
      routeTemplate = "/items/:id",
    ) =>
      runWithTenant({ id, slug: "tenant" }, () =>
        runWithAuthUser({ id: 1, role: "member", tokenId: token }, () =>
          runWithRequestMeta({ ipAddress: null, userAgent: null, routeTemplate }, () =>
            middleware(
              new Request(`https://example.test/items/${path}`, {
                method,
                headers: { accept: "application/json" },
              }),
              next,
            ),
          ),
        ),
      );
    expect((await invoke(1, 1)).status).toBe(200);
    expect((await invoke(1, 1, "GET", "b")).status).toBe(429);
    expect((await invoke(2, 1)).status).toBe(200);
    expect((await invoke(1, 2)).status).toBe(200);
    expect((await invoke(1, 1, "POST")).status).toBe(200);
    expect((await invoke(1, 1, "GET", "c", "/other/:id")).status).toBe(200);
    middleware.dispose();
  });

  test("unique unknown URLs and forged tokens cannot create buckets or bypass existing limits", async () => {
    const middleware = createMemoryThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      maxBuckets: 2,
    });
    for (let i = 0; i < 1000; i++) {
      const response = await middleware(
        new Request(`https://example.test/unknown-${i}`, {
          headers: { authorization: `Bearer forged-${i}`, accept: "application/json" },
        }),
        async () => new Response("ok"),
      );
      expect(response.status).toBe(i === 0 ? 200 : 429);
    }
    expect(middleware.stats().retainedBuckets).toBe(1);
    middleware.dispose();
    middleware.dispose();
    expect(middleware.stats().retainedBuckets).toBe(0);
    expect(
      (await middleware(new Request("https://example.test/a"), async () => new Response("bypass")))
        .status,
    ).toBe(503);
  });

  test("storage saturation and invalid policies fail closed; disposal does not affect other instances", async () => {
    const first = createMemoryThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      maxBuckets: 1,
    });
    const second = createMemoryThrottleMiddleware({ maxAttempts: 1, decaySeconds: 60 });
    const request = new Request("https://example.test/a", {
      headers: { accept: "application/json" },
    });
    const next = async () => new Response("ok");
    expect((await first(request, next)).status).toBe(200);
    expect(
      (await runWithAuthUser({ id: 2, role: "member" }, () => first(request, next))).status,
    ).toBe(503);
    expect((await first(request, next)).status).toBe(429);
    first.dispose();
    expect((await second(request, next)).status).toBe(200);
    second.dispose();
    for (const [quotaPolicy, status] of [
      [() => 0, 429],
      [() => NaN, 503],
      [
        () => {
          throw new Error("private");
        },
        503,
      ],
    ] as const) {
      const policy = createMemoryThrottleMiddleware({
        maxAttempts: 1,
        decaySeconds: 60,
        quotaPolicy,
      });
      const response = await policy(request, next);
      expect(response.status).toBe(status);
      policy.dispose();
    }
    expect(() => createMemoryThrottleMiddleware({ maxAttempts: -1, decaySeconds: 60 })).toThrow(
      "limit",
    );
  });
});
