import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/bootstrap/config";
import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createWebRoutes, mergeWebRoutes } from "@getstrata/bootstrap/createWebRoutes";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { PolicyGate } from "@getstrata/core/auth/policy";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { SyncQueue } from "@getstrata/core/queue";
import { tokenServiceToken } from "../../src/modules/user/provider";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies } from "./testHelpers";

const PUBLIC_ASSETS_DIR = join(process.cwd(), "public/assets");

function createTestDependencies(): AppDependencies {
  const container = new ServiceContainer();
  const dependencies = createMockDependencies(
    container,
    new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
  );

  dependencies.container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  dependencies.container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  dependencies.container.set(CORE_QUEUE_TOKEN, new SyncQueue());
  dependencies.container.set(tokenServiceToken, {
    requireAbility: () => undefined,
    tokenCan: () => true,
  });

  return dependencies;
}

describe("createWebRoutes", () => {
  const previousFrontendMode = process.env.FRONTEND_MODE;

  beforeAll(async () => {
    await ensureModulesLoaded();
  });

  beforeEach(async () => {
    routeRegistry.clear();
    process.env.FRONTEND_MODE = "server-htmx";
    await mkdir(PUBLIC_ASSETS_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (previousFrontendMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      restoreEnvVar("FRONTEND_MODE", previousFrontendMode);
    }

    await rm(join(PUBLIC_ASSETS_DIR, "coverage-test.css"), { force: true });
  });

  test("registers a root redirect and module web routes", async () => {
    const routes = createWebRoutes(createTestDependencies());

    expect(routes["/"]).toBeDefined();
    const response = await routes["/"](new Request("http://localhost/"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/organizations");

    expect(routes["/organizations"]).toBeDefined();
    expect(routes["/login"]).toBeDefined();
  });

  test("serves static assets from public/", async () => {
    await writeFile(join(PUBLIC_ASSETS_DIR, "coverage-test.css"), "body { color: black; }");

    const routes = createWebRoutes(createTestDependencies());
    const handler = routes["/assets/*"];
    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error("Expected /assets/* route handler");
    }

    const response = await handler(new Request("http://localhost/assets/coverage-test.css"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("body { color: black; }");
  });

  test("returns 404 HTML for missing assets", async () => {
    const routes = createWebRoutes(createTestDependencies());
    const handler = routes["/assets/*"];
    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error("Expected /assets/* route handler");
    }

    const response = await handler(new Request("http://localhost/assets/missing.css"));
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain("Not Found");
  });
});

describe("mergeWebRoutes", () => {
  const previousFrontendMode = process.env.FRONTEND_MODE;

  beforeAll(async () => {
    await ensureModulesLoaded();
  });

  afterEach(() => {
    if (previousFrontendMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      restoreEnvVar("FRONTEND_MODE", previousFrontendMode);
    }
  });

  test("returns api routes unchanged when views are disabled", () => {
    process.env.FRONTEND_MODE = "api";
    const apiRoutes: AppRouteMap = {
      "/health": {
        GET: async () => Response.json({ ok: true }),
      },
    };

    expect(mergeWebRoutes(createTestDependencies(), apiRoutes)).toBe(apiRoutes);
  });

  test("merges web routes ahead of api routes when views are enabled", () => {
    process.env.FRONTEND_MODE = "server-htmx";
    const apiRoutes: AppRouteMap = {
      "/health": {
        GET: async () => Response.json({ ok: true }),
      },
    };

    const merged = mergeWebRoutes(createTestDependencies(), apiRoutes);

    expect(merged["/"]).toBeDefined();
    expect(merged["/health"]).toBeDefined();
    expect(merged["/organizations"]).toBeDefined();
  });
});
