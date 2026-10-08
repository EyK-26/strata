import { describe, expect, test } from "bun:test";
import { createScimThrottleMiddleware } from "@getstrata/core/http/scimThrottleMiddleware";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("createScimThrottleMiddleware", () => {
  test("bounds distinct local credentials without evicting lockouts", async () => {
    const middleware = createScimThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      maxBuckets: 1,
    });
    const request = (secret: string) =>
      new Request("http://example.test/scim/v2/Users", {
        headers: { authorization: `Bearer ${secret}` },
      });
    const next = async () => new Response("ok");
    expect((await middleware(request("one"), next)).status).toBe(200);
    expect((await middleware(request("two"), next)).status).toBe(503);
    expect((await middleware(request("one"), next)).status).toBe(429);
    middleware.dispose();
    expect(middleware.stats()?.retainedBuckets).toBe(0);
    expect((await middleware(request("one"), next)).status).toBe(503);
    expect(() => createScimThrottleMiddleware({ maxAttempts: -1, decaySeconds: 60 })).toThrow(
      "limit",
    );
  });

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

describe("SCIM distributed failure contracts", () => {
  test("pre-auth buckets use the trusted SCIM token tenant rather than surrounding scope", async () => {
    const previous = process.env.SCIM_TENANT_TOKENS;
    process.env.SCIM_TENANT_TOKENS = "2:trusted-token";
    const counts = new Map<string, number>();
    const keys: string[] = [];
    const throttle = createScimThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      redisClient: {
        send: async (_command, args) => {
          const key = args[2] ?? "";
          keys.push(key);
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          return count;
        },
      },
    });
    const request = new Request("http://example.test/scim/v2/Users", {
      headers: { authorization: "Bearer trusted-token" },
    });
    try {
      for (const id of [1, 3]) {
        const response = await runWithTenant({ id, slug: "surrounding" }, () =>
          throttle(request, async () => new Response("ok")),
        );
        expect(response.status).toBe(id === 1 ? 200 : 429);
      }
      expect(keys[0]).toBe(keys[1]);
    } finally {
      throttle.dispose();
      restoreEnvVar("SCIM_TENANT_TOKENS", previous);
    }
  });

  test("failed, malformed and stalled stores return a safe 503 without local fallback", async () => {
    for (const send of [
      async () => {
        throw new Error("private Redis credentials");
      },
      async () => "invalid",
      async () => new Promise<never>(() => {}),
    ]) {
      const throttle = createScimThrottleMiddleware({
        redisUrl: "unused",
        redisClient: { send },
        commandTimeoutMs: 5,
        maxAttempts: 120,
        decaySeconds: 60,
      });
      for (let i = 0; i < 2; i++) {
        const response = await throttle(
          new Request("http://example.test/scim/v2/Users"),
          async () => {
            throw new Error("must not admit");
          },
        );
        expect(response.status).toBe(503);
        expect(response.headers.get("retry-after")).toBe("1");
        expect(await response.text()).not.toContain("private");
      }
      throttle.dispose();
    }
  });

  test("handler failures remain business errors, and zero quotas block the first request", async () => {
    const options = { redisClient: { send: async () => 1 }, maxAttempts: 1, decaySeconds: 60 };
    const throttle = createScimThrottleMiddleware(options);
    await expect(
      throttle(new Request("http://example.test/scim/v2/Users"), async () => {
        throw new Error("business");
      }),
    ).rejects.toThrow("business");
    const deny = createScimThrottleMiddleware({ ...options, maxAttempts: 0 });
    expect(
      (
        await deny(
          new Request("http://example.test/scim/v2/Users"),
          async () => new Response("bypass"),
        )
      ).status,
    ).toBe(429);
    throttle.dispose();
    deny.dispose();
  });
});
