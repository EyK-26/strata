import { afterEach, describe, expect, test } from "bun:test";
import { CORE_CONFIG_TOKEN, REDIS_URL_CONFIG_KEY } from "@getstrata/bootstrap/config";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { checkDatabase, createHealthRoutes } from "@getstrata/bootstrap/health";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { createMockDependencies } from "./testHelpers";

describe("createHealthRoutes", () => {
  afterEach(() => {
    resetBoundDatabaseConnection();
  });

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

  test("pings the bound database connection from checkDatabase", async () => {
    const queries: string[] = [];
    bindDatabaseConnection({
      async unsafe<T>(query: string) {
        queries.push(query);
        return [{ ok: 1 }] as T[];
      },
    });

    expect(await checkDatabase()).toBe(true);
    expect(queries).toEqual(["SELECT 1"]);
  });

  test("createHealthRoutes /ready uses the bound database client", async () => {
    const queries: string[] = [];
    bindDatabaseConnection({
      async unsafe<T>(query: string) {
        queries.push(query);
        return [{ ok: 1 }] as T[];
      },
    });

    const container = new ServiceContainer();
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, "");
    container.set(CORE_CONFIG_TOKEN, config);

    const routes = createHealthRoutes(
      createMockDependencies(
        container,
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
      { extra: { app: "sibling" } },
    );

    const response = await routes["/ready"]();
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
      app?: string;
    };

    expect(queries).toContain("SELECT 1");
    expect(body.checks.database).toBe("ok");
    expect(body.app).toBe("sibling");
    expect(body.status).toBe("ready");
    expect(response.status).toBe(200);
  });

  test("pingOnHealth includes database checks on /health", async () => {
    bindDatabaseConnection({
      async unsafe<T>() {
        return [{ ok: 1 }] as T[];
      },
    });

    const routes = createHealthRoutes(
      createMockDependencies(
        new ServiceContainer(),
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
      { pingOnHealth: true },
    );

    const response = await routes["/health"]();
    const body = (await response.json()) as { status: string; checks: Record<string, string> };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
  });

  test("returns readiness details from /ready", async () => {
    bindDatabaseConnection({
      async unsafe<T>() {
        return [{ ok: 1 }] as T[];
      },
    });

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
