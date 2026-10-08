import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { createLoginThrottleMiddleware } from "@getstrata/core/http/loginThrottleMiddleware";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { createScimThrottleMiddleware } from "@getstrata/core/http/scimThrottleMiddleware";
import {
  consumeRedisThrottle,
  createRedisThrottleConsumer,
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
    await expect(consumeRedisThrottle(client, "test", Number.MAX_VALUE)).rejects.toThrow(
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

describe("application-owned quota policy", () => {
  test("default limits never interpret legacy plan names", async () => {
    for (const plan of ["free", "pro", "enterprise", "custom"]) {
      const middleware = createThrottleMiddleware({
        redisUrl: "redis://unused",
        maxAttempts: 1,
        decaySeconds: 60,
        redisClient: { send: async () => 2 },
      });
      const response = await runWithTenant({ id: 1, slug: "tenant", plan }, () =>
        middleware(
          new Request("http://example.test/api", { headers: { accept: "application/json" } }),
          async () => new Response("ok"),
        ),
      );
      expect(response.status).toBe(429);
    }
  });

  test("different policies use trusted tenant metadata and registered route identity", async () => {
    for (const entitlement of ["campus", "unknown"]) {
      for (const allowance of [2, 3]) {
        const middleware = createThrottleMiddleware({
          redisUrl: "redis://unused",
          maxAttempts: 1,
          decaySeconds: 60,
          redisClient: { send: async () => 2 },
          quotaPolicy: (context) => {
            expect(context.identity).toBe("token:42");
            expect(context.routeTemplate).toBe("/orders/:id");
            expect(context.request.method).toBe("GET");
            return context.tenant?.metadata?.entitlement === "campus"
              ? allowance
              : context.maxAttempts;
          },
        });
        const response = await runWithTenant(
          { id: 9, slug: "acme", metadata: { entitlement } },
          () =>
            runWithAuthUser({ id: 1, role: "member", tokenId: 42 }, () =>
              runWithRequestMeta(
                { ipAddress: null, userAgent: null, routeTemplate: "/orders/:id" },
                () =>
                  middleware(
                    new Request("http://example.test/orders/123", {
                      headers: { accept: "application/json", "x-plan": "campus" },
                    }),
                    async () => new Response("ok"),
                  ),
              ),
            ),
        );
        expect(response.status).toBe(entitlement === "campus" ? 200 : 429);
      }
    }
  });

  test("broken policy fails closed without accessing Redis or leaking details", async () => {
    for (const quotaPolicy of [
      () => Number.NaN,
      () => Infinity,
      () => -1,
      () => 0.5,
      () => Number.MAX_SAFE_INTEGER + 1,
      () => {
        throw new Error("private policy data");
      },
      (() => undefined) as unknown as () => number,
      (() => null) as unknown as () => number,
      (async () => 10) as unknown as () => number,
    ]) {
      let consumed = false;
      const middleware = createThrottleMiddleware({
        redisUrl: "redis://unused",
        maxAttempts: 1,
        decaySeconds: 60,
        quotaPolicy,
        redisClient: {
          send: async () => {
            consumed = true;
            return 1;
          },
        },
      });
      const response = await middleware(
        new Request("http://example.test/a"),
        async () => new Response("bypass"),
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private");
      expect(consumed).toBe(false);
    }
  });

  test("zero denies access and generous policies cannot bypass store outages", async () => {
    for (const failing of [false, true]) {
      const middleware = createThrottleMiddleware({
        redisUrl: "redis://unused",
        maxAttempts: 1,
        decaySeconds: 60,
        quotaPolicy: () => (failing ? 999 : 0),
        redisClient: {
          send: async () => {
            if (failing) throw new Error("offline");
            return 1;
          },
        },
      });
      const response = await middleware(
        new Request("http://example.test/a", { headers: { accept: "application/json" } }),
        async () => new Response("bypass"),
      );
      expect(response.status).toBe(failing ? 503 : 429);
    }
    expect(() =>
      createThrottleMiddleware({ redisUrl: "unused", maxAttempts: -1, decaySeconds: 60 }),
    ).toThrow("maxAttempts");
  });
});

describe("Redis throttle ownership", () => {
  test("disposal cancels a pending command without closing or reusing an injected client", async () => {
    let calls = 0;
    let closed = 0;
    let complete: (value: number) => void = () => {};
    const client = {
      send: async () => {
        calls++;
        return await new Promise<number>((resolve) => {
          complete = resolve;
        });
      },
      close: () => {
        closed++;
      },
    };
    const consumer = createRedisThrottleConsumer({
      redisUrl: "unused",
      redisClient: client,
      commandTimeoutMs: 60_000,
    });
    const pending = consumer("key", 60);
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );
    consumer.dispose();
    consumer.dispose();
    expect(await outcome).toBeInstanceOf(Error);
    expect(String(await outcome)).toContain("disposed");
    complete(1);
    await expect(consumer("key", 60)).rejects.toThrow("disposed");
    expect(calls).toBe(1);
    expect(closed).toBe(0);
    expect(consumer.isDisposed()).toBe(true);
  });

  test("API, login and SCIM middleware never admit late completion after disposal", async () => {
    for (const factory of [
      createThrottleMiddleware,
      createLoginThrottleMiddleware,
      createScimThrottleMiddleware,
    ]) {
      let complete: (value: number) => void = () => {};
      let started: () => void = () => {};
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const throttle = factory({
        redisUrl: "unused",
        maxAttempts: 1,
        decaySeconds: 60,
        redisClient: {
          send: async () => {
            started();
            return await new Promise<number>((resolve) => {
              complete = resolve;
            });
          },
        },
      });
      let admitted = false;
      const request = new Request("http://example.test/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.test" }),
      });
      const pending = throttle(request, async () => {
        admitted = true;
        return new Response("bypass");
      });
      await entered;
      throttle.dispose();
      complete(1);
      expect((await pending).status).toBe(503);
      expect(admitted).toBe(false);
      expect((await throttle(request, async () => new Response("bypass"))).status).toBe(503);
    }
  });

  test("aborted consumption sends no command", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      consumeRedisThrottle(
        {
          send: async () => {
            throw new Error("must not send");
          },
        },
        "key",
        60,
        1000,
        controller.signal,
      ),
    ).rejects.toThrow("disposed");
  });
});
