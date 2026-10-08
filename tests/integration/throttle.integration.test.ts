import { describe, expect, spyOn, test } from "bun:test";
import { createLoginThrottleMiddleware } from "@getstrata/core/http/loginThrottleMiddleware";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import {
  createScimThrottleMiddleware,
  resolveScimIdentity,
} from "@getstrata/core/http/scimThrottleMiddleware";
import {
  consumeRedisThrottle,
  createRedisThrottleConsumer,
  createThrottleMiddleware,
  redisThrottleKey,
} from "@getstrata/core/http/throttleMiddleware";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import { RedisClient } from "bun";

const redisUrl = process.env.REDIS_URL?.trim() ?? "";
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis("atomic distributed throttles", () => {
  test("three independent clients enforce one route bucket and retain a TTL", async () => {
    const clients = [
      new RedisClient(redisUrl),
      new RedisClient(redisUrl),
      new RedisClient(redisUrl),
    ] as const;
    const prefix = `throttle-test-${crypto.randomUUID()}`;
    const request = new Request("http://example.test/orders/some-slug");
    const meta = { ipAddress: "203.0.113.60", userAgent: null, routeTemplate: "/orders/:slug" };
    const key = await runWithRequestMeta(meta, () =>
      redisThrottleKey(request, prefix, meta.ipAddress),
    );
    try {
      const middleware = clients.map((redisClient) =>
        createThrottleMiddleware({
          redisUrl,
          redisClient,
          keyPrefix: prefix,
          maxAttempts: 7,
          decaySeconds: 60,
        }),
      );
      const responses = await runWithRequestMeta(meta, () =>
        Promise.all(
          Array.from({ length: 100 }, (_, index) =>
            middleware[index % 3]?.(request, async () => new Response("allowed")),
          ),
        ),
      );
      expect(responses.filter((response) => response?.status === 200)).toHaveLength(7);
      expect(responses.filter((response) => response?.status === 429)).toHaveLength(93);
      expect(Number(await clients[0].get(key))).toBe(100);
      const ttl = Number(await clients[0].send("PTTL", [key]));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60_000);
      await clients[0].set(key, "4"); // Reproduce a legacy immortal counter.
      expect(await consumeRedisThrottle(clients[1], key, 60)).toBe(5);
      expect(Number(await clients[0].send("PTTL", [key]))).toBeGreaterThan(0);
    } finally {
      await clients[0].del(key);
      for (const client of clients) client.close();
    }
  });

  test("application quotas remain tenant-isolated across three Redis clients", async () => {
    const clients = [
      new RedisClient(redisUrl),
      new RedisClient(redisUrl),
      new RedisClient(redisUrl),
    ] as const;
    const prefix = `quota-test-${crypto.randomUUID()}`;
    const request = new Request("http://example.test/resources/42", {
      headers: { accept: "application/json" },
    });
    const meta = { ipAddress: "203.0.113.60", userAgent: null, routeTemplate: "/resources/:id" };
    const keys: string[] = [];
    try {
      const middleware = clients.map((redisClient) =>
        createThrottleMiddleware({
          redisUrl,
          redisClient,
          keyPrefix: prefix,
          maxAttempts: 1,
          decaySeconds: 60,
          quotaPolicy: ({ tenant, maxAttempts }) =>
            tenant?.metadata?.entitlement === "campus" ? 7 : maxAttempts,
        }),
      );
      const responses = await Promise.all(
        ["campus", "unknown"].map((entitlement, index) =>
          runWithTenant({ id: index + 1, slug: entitlement, metadata: { entitlement } }, () =>
            runWithRequestMeta(meta, async () => {
              keys.push(redisThrottleKey(request, prefix, meta.ipAddress));
              return await Promise.all(
                Array.from({ length: 30 }, (_, i) =>
                  middleware[i % 3]?.(request, async () => new Response("ok")),
                ),
              );
            }),
          ),
        ),
      );
      expect(responses[0]?.filter((r) => r?.status === 200)).toHaveLength(7);
      expect(responses[1]?.filter((r) => r?.status === 200)).toHaveLength(1);
      expect(new Set(keys).size).toBe(2);
      for (const key of keys) {
        expect(Number(await clients[0].get(key))).toBe(30);
        expect(Number(await clients[0].send("PTTL", [key]))).toBeGreaterThan(0);
      }
    } finally {
      for (const key of keys) await clients[0].del(key);
      for (const client of clients) client.close();
    }
  });

  test("login admission is shared, normalized, and atomic across clients", async () => {
    const clients = [
      new RedisClient(redisUrl),
      new RedisClient(redisUrl),
      new RedisClient(redisUrl),
    ] as const;
    const prefix = `login-test-${crypto.randomUUID()}`;
    const meta = { ipAddress: "203.0.113.61", userAgent: null, routeTemplate: "/auth/login" };
    const request = () =>
      new Request("http://example.test/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: " DEMO@EXAMPLE.TEST ", password: "password" }),
      });
    const key = await runWithRequestMeta(meta, () =>
      redisThrottleKey(request(), prefix, JSON.stringify([meta.ipAddress, "demo@example.test"])),
    );
    try {
      const middleware = clients.map((redisClient) =>
        createLoginThrottleMiddleware({
          redisUrl,
          redisClient,
          keyPrefix: prefix,
          maxAttempts: 2,
          decaySeconds: 60,
        }),
      );
      const responses = await runWithRequestMeta(meta, () =>
        Promise.all(
          Array.from({ length: 50 }, (_, index) =>
            middleware[index % 3]?.(request(), async () => new Response("allowed")),
          ),
        ),
      );
      expect(responses.filter((response) => response?.status === 200)).toHaveLength(2);
      expect(responses.filter((response) => response?.status === 429)).toHaveLength(48);
      expect(Number(await clients[0].get(key))).toBe(50);
      expect(Number(await clients[0].send("PTTL", [key]))).toBeGreaterThan(0);
    } finally {
      await clients[0].del(key);
      for (const client of clients) client.close();
    }
  });

  test("an unavailable Redis returns 503 and never admits a request", async () => {
    for (const middleware of [
      createThrottleMiddleware({
        redisUrl: "redis://127.0.0.1:1",
        maxAttempts: 100,
        decaySeconds: 60,
        commandTimeoutMs: 50,
      }),
      createLoginThrottleMiddleware({
        redisUrl: "redis://127.0.0.1:1",
        maxAttempts: 100,
        decaySeconds: 60,
        commandTimeoutMs: 50,
      }),
    ]) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await middleware(
          new Request("http://example.test/auth/login"),
          async () => {
            throw new Error("must not admit");
          },
        );
        expect(response?.status).toBe(503);
      }
    }
  });
});

describeRedis("SCIM atomic ownership", () => {
  test("three clients share SCIM admission with TTL repair and isolated tenant/route buckets", async () => {
    const clients = [
      new RedisClient(redisUrl),
      new RedisClient(redisUrl),
      new RedisClient(redisUrl),
    ] as const;
    const prefix = `scim-test-${crypto.randomUUID()}`;
    const meta = {
      ipAddress: "203.0.113.62",
      userAgent: null,
      routeTemplate: "/scim/v2/Users/:id",
    };
    const request = new Request("http://example.test/scim/v2/Users/42", {
      headers: { authorization: "Bearer private-scim-key" },
    });
    const keys: string[] = [];
    const throttles = clients.map((redisClient) =>
      createScimThrottleMiddleware({
        redisUrl,
        redisClient,
        keyPrefix: prefix,
        maxAttempts: 7,
        decaySeconds: 60,
      }),
    );
    try {
      await runWithTenant({ id: 1, slug: "one" }, () =>
        runWithRequestMeta(meta, async () => {
          const key = redisThrottleKey(request, prefix, resolveScimIdentity(request));
          keys.push(key);
          const responses = await Promise.all(
            Array.from({ length: 100 }, (_, i) =>
              throttles[i % 3]?.(request, async () => new Response("ok")),
            ),
          );
          expect(responses.filter((r) => r?.status === 200)).toHaveLength(7);
          expect(Number(await clients[0].get(key))).toBe(100);
          expect(Number(await clients[0].send("PTTL", [key]))).toBeGreaterThan(0);
          expect(key).not.toContain("private");
          await clients[0].set(key, "7");
          expect((await throttles[1]?.(request, async () => new Response("bypass")))?.status).toBe(
            429,
          );
          expect(Number(await clients[0].send("PTTL", [key]))).toBeGreaterThan(0);
        }),
      );
      for (const [id, routeTemplate] of [
        [2, meta.routeTemplate],
        [1, "/scim/v2/Groups/:id"],
      ] as const) {
        await runWithTenant({ id, slug: "other" }, () =>
          runWithRequestMeta({ ...meta, routeTemplate }, async () => {
            keys.push(redisThrottleKey(request, prefix, resolveScimIdentity(request)));
            expect((await throttles[0]?.(request, async () => new Response("ok")))?.status).toBe(
              200,
            );
          }),
        );
      }
      expect(new Set(keys).size).toBe(3);
      for (const throttle of throttles) throttle.dispose();
      expect(await clients[0].ping()).toBe("PONG");
    } finally {
      for (const key of keys) await clients[0].del(key);
      for (const throttle of throttles) throttle.dispose();
      for (const client of clients) client.close();
    }
  });

  test("SCIM outages fail closed on successive attempts and disposal", async () => {
    const throttle = createScimThrottleMiddleware({
      redisUrl: "redis://127.0.0.1:1",
      maxAttempts: 120,
      decaySeconds: 60,
      commandTimeoutMs: 50,
    });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await throttle(
            new Request("http://example.test/scim/v2/Users"),
            async () => new Response("bypass"),
          )
        ).status,
      ).toBe(503);
    throttle.dispose();
    throttle.dispose();
    expect(
      (
        await throttle(
          new Request("http://example.test/scim/v2/Users"),
          async () => new Response("bypass"),
        )
      ).status,
    ).toBe(503);
  });

  test("owned Redis connections close once and disposed consumers cannot reconnect", async () => {
    const close = spyOn(RedisClient.prototype, "close");
    const consumer = createRedisThrottleConsumer({ redisUrl });
    const key = `owned-throttle-${crypto.randomUUID()}`;
    const inspector = new RedisClient(redisUrl);
    try {
      expect(await consumer(key, 60)).toBe(1);
      consumer.dispose();
      consumer.dispose();
      expect(close).toHaveBeenCalledTimes(1);
      await expect(consumer(key, 60)).rejects.toThrow("disposed");
      expect(close).toHaveBeenCalledTimes(1);
      expect(await inspector.get(key)).toBe("1");
    } finally {
      consumer.dispose();
      close.mockRestore();
      await inspector.del(key);
      inspector.close();
    }
  });
});

describe("pending owned connection teardown", () => {
  test("disposal cancels an actual stalled socket and permanently prevents reconnects", async () => {
    let accepted = 0;
    let commandStarted: () => void = () => {};
    let disconnected: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      commandStarted = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          accepted++;
        },
        data() {
          commandStarted();
        }, // Intentionally withhold every Redis response.
        close() {
          disconnected();
        },
      },
    });
    const consumer = createRedisThrottleConsumer({
      redisUrl: `redis://127.0.0.1:${server.port}`,
      commandTimeoutMs: 1000,
    });
    const result = consumer("stalled-owned", 60).then(
      () => null,
      (error: unknown) => error,
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Socket teardown did not finish")), 2000);
    });
    try {
      await Promise.race([started, deadline]);
      consumer.dispose();
      expect(String(await result)).toContain("disposed");
      await Promise.race([closed, deadline]);
      await expect(consumer("closed", 60)).rejects.toThrow("disposed");
      expect(accepted).toBe(1);
    } finally {
      clearTimeout(timeout);
      consumer.dispose();
      server.stop(true);
    }
  });
});
