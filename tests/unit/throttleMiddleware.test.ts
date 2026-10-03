import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import {
  consumeRedisThrottle,
  createThrottleMiddleware,
  redisThrottleKey,
  resolveThrottleIdentity,
} from "@getstrata/core/http/throttleMiddleware";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("resolveThrottleIdentity", () => {
  test("prefers token id for bearer-authenticated requests", () => {
    const request = new Request("http://example.test/api/v1/projects");

    const identity = runWithAuthUser({ id: 1, role: "admin", tokenId: 42 }, () =>
      resolveThrottleIdentity(request),
    );

    expect(identity).toBe("token:42");
  });

  test("falls back to user id when no token id is present", () => {
    const request = new Request("http://example.test/api/v1/projects");

    const identity = runWithAuthUser({ id: 7, role: "member" }, () =>
      resolveThrottleIdentity(request),
    );

    expect(identity).toBe("user:7");
  });

  test("uses forwarded ip for guests when TRUST_FORWARDED_FOR is enabled", () => {
    const previous = process.env.TRUST_FORWARDED_FOR;
    process.env.TRUST_FORWARDED_FOR = "true";

    try {
      const request = new Request("http://example.test/api/v1/projects", {
        headers: {
          "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        },
      });

      expect(resolveThrottleIdentity(request)).toBe("203.0.113.10");
    } finally {
      restoreEnvVar("TRUST_FORWARDED_FOR", previous);
    }
  });

  test("does not treat x-forwarded-for as identity unless TRUST_FORWARDED_FOR is enabled", () => {
    const request = new Request("http://example.test/api/v1/projects", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });

    expect(resolveThrottleIdentity(request)).toBe("unknown");
  });
});

describe("distributed throttle failure boundaries", () => {
  test("failed, malformed, and stalled stores return 503 without calling the handler", async () => {
    for (const send of [
      async () => {
        throw new Error("redis credential secret");
      },
      async () => "invalid",
      async () => new Promise<never>(() => {}),
    ]) {
      const middleware = createThrottleMiddleware({
        redisUrl: "redis://unused",
        maxAttempts: 1,
        decaySeconds: 60,
        commandTimeoutMs: 5,
        redisClient: { send },
      });
      let called = false;
      const response = await middleware(new Request("http://example.test/a"), async () => {
        called = true;
        return new Response("bypassed");
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(await response.text()).not.toContain("secret");
      expect(called).toBe(false);
    }
  });

  test("does not turn a handler error into a throttle failure", async () => {
    const middleware = createThrottleMiddleware({
      redisUrl: "redis://unused",
      maxAttempts: 1,
      decaySeconds: 60,
      redisClient: { send: async () => 1 },
    });
    await expect(
      middleware(new Request("http://example.test/a"), async () => {
        throw new Error("business failure");
      }),
    ).rejects.toThrow("business failure");
  });

  test("keys registered routes, methods and tenants inside the app namespace without raw identities", async () => {
    const request = new Request("http://example.test/orders/private-slug?secret=hidden");
    const key = await runWithRequestMeta(
      { ipAddress: null, userAgent: null, routeTemplate: "/orders/:slug" },
      () => redisThrottleKey(request, "custom", "private@example.test"),
    );
    expect(key).toStartWith(`${process.env.APP_KEY_PREFIX?.trim() || "strata"}:custom:`);
    expect(key).not.toContain("private");
    expect(key).not.toContain("hidden");
    const same = await runWithRequestMeta(
      { ipAddress: null, userAgent: null, routeTemplate: "/orders/:slug" },
      () =>
        redisThrottleKey(
          new Request("http://example.test/orders/other"),
          "custom",
          "private@example.test",
        ),
    );
    expect(same).toBe(key);
    const otherMethod = await runWithRequestMeta(
      { ipAddress: null, userAgent: null, routeTemplate: "/orders/:slug" },
      () =>
        redisThrottleKey(
          new Request(request, { method: "POST" }),
          "custom",
          "private@example.test",
        ),
    );
    expect(otherMethod).not.toBe(key);
    const otherTenant = await runWithTenant(
      { id: 99, slug: "other", plan: "free", region: "eu" },
      () =>
        runWithRequestMeta(
          { ipAddress: null, userAgent: null, routeTemplate: "/orders/:slug" },
          () => redisThrottleKey(request, "custom", "private@example.test"),
        ),
    );
    expect(otherTenant).not.toBe(key);
    expect(redisThrottleKey(new Request("http://example.test/unknown-a"), "custom", "guest")).toBe(
      redisThrottleKey(new Request("http://example.test/unknown-b"), "custom", "guest"),
    );
  });

  test("invalid deadlines/TTLs and invalid counters are rejected", async () => {
    const client = { send: async () => 0 };
    await expect(consumeRedisThrottle(client, "test", -1)).rejects.toThrow(
      "Invalid throttle expiry",
    );
    await expect(consumeRedisThrottle(client, "test", 1, 0)).rejects.toThrow(
      "Invalid throttle expiry",
    );
    await expect(consumeRedisThrottle(client, "test", 1)).rejects.toThrow(
      "Invalid throttle store response",
    );
  });
});
