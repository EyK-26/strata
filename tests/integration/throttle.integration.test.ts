import { describe, expect, test } from "bun:test";
import { createLoginThrottleMiddleware } from "@getstrata/core/http/loginThrottleMiddleware";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import {
  consumeRedisThrottle,
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
