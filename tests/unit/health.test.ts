import { describe, expect, test } from "bun:test";
import { CORE_CONFIG_TOKEN, REDIS_URL_CONFIG_KEY } from "@getstrata/bootstrap/config";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { createMockDependencies } from "./testHelpers";

describe("createHealthRoutes", () => {
  test("returns ok from /health without touching dependencies", async () => {
    const routes = createHealthRoutes(
      createMockDependencies(
        new ServiceContainer(),
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
    );

    const response = await routes["/health"]();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("returns readiness details from /ready", async () => {
    const container = new ServiceContainer();
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, process.env.REDIS_URL ?? "");
    container.set(CORE_CONFIG_TOKEN, config);

    const routes = createHealthRoutes(
      createMockDependencies(
        container,
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
    );

    const response = await routes["/ready"]();
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
    };

    expect(body.checks.database).toBe("ok");
    const redisStatus = body.checks.redis;

    if (!redisStatus) {
      throw new Error("Expected redis readiness check.");
    }

    expect(["ok", "skipped", "error"]).toContain(redisStatus);
    expect([200, 503]).toContain(response.status);
  });
});
