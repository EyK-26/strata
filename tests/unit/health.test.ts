import { describe, expect, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import { createHealthRoutes } from "../../src/bootstrap/health";
import { CORE_CONFIG_TOKEN, REDIS_URL_CONFIG_KEY } from "../../src/bootstrap/config";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";

describe("createHealthRoutes", () => {
  test("returns ok from /health without touching dependencies", async () => {
    const routes = createHealthRoutes({
      container: new ServiceContainer(),
      cache: new CacheRepository(
        new SimpleCacheStore(new SimpleCache(60_000, 20)),
      ),
    });

    const response = await routes["/health"]();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("returns readiness details from /ready", async () => {
    const container = new ServiceContainer();
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, process.env.REDIS_URL ?? "");
    container.set(CORE_CONFIG_TOKEN, config);

    const routes = createHealthRoutes({
      container,
      cache: new CacheRepository(
        new SimpleCacheStore(new SimpleCache(60_000, 20)),
      ),
    });

    const response = await routes["/ready"]();
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
    };

    expect(body.checks.database).toBe("ok");
    expect(body.checks.redis).toBeDefined();
    expect(["ok", "skipped", "error"]).toContain(body.checks.redis!);
    expect([200, 503]).toContain(response.status);
  });
});
