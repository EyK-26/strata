import { describe, expect, test } from "bun:test";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { PolicyGate } from "@getstrata/core/auth/policy";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { CORE_TOKEN_SERVICE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { SyncQueue } from "@getstrata/core/queue";
import { createMockDependencies } from "./testHelpers";

const fixtureModule: AppModule = {
  name: "reports",
  routes() {
    return {
      "/reports/summary": async () => Response.json({ ok: true }),
    };
  },
};

function createTestDependencies() {
  const container = new ServiceContainer();
  const dependencies = createMockDependencies(
    container,
    new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
  );

  dependencies.container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  dependencies.container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  dependencies.container.set(CORE_QUEUE_TOKEN, new SyncQueue());
  dependencies.container.set(CORE_TOKEN_SERVICE_TOKEN, {
    requireAbility: () => undefined,
    tokenCan: () => true,
  });

  return dependencies;
}

describe("buildModuleRoutes", () => {
  test("builds prefixed module routes from supplied modules", () => {
    const dependencies = createTestDependencies();
    const routes = buildModuleRoutes(dependencies, {
      apiPrefix: "/api",
      modules: [fixtureModule],
    });

    expect(typeof routes["/api/reports/summary"]).toBe("function");
  });

  test("can append routes without clearing the OpenAPI registry", () => {
    const dependencies = createTestDependencies();
    const firstCount = buildModuleRoutes(dependencies, {
      apiPrefix: "/api",
      modules: [fixtureModule],
    });
    const secondCount = buildModuleRoutes(dependencies, {
      apiPrefix: "/api",
      modules: [fixtureModule],
      clearRegistry: false,
    });

    expect(Object.keys(firstCount).length).toBeGreaterThan(0);
    expect(Object.keys(secondCount).length).toBeGreaterThan(0);
  });
});
