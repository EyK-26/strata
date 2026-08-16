import { beforeAll, describe, expect, test } from "bun:test";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { buildWebModuleRoutes } from "../../src/bootstrap/buildWebModuleRoutes";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { PolicyGate } from "../../src/core/auth/policy";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { SyncQueue } from "../../src/core/queue";
import { createMockDependencies } from "./testHelpers";

function createTestDependencies() {
  const container = new ServiceContainer();
  const dependencies = createMockDependencies(
    container,
    new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
  );

  dependencies.container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  dependencies.container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  dependencies.container.set(CORE_QUEUE_TOKEN, new SyncQueue());

  return dependencies;
}

describe("buildWebModuleRoutes", () => {
  beforeAll(async () => {
    await ensureModulesLoaded();
  });

  test("builds web routes from discovered module webRoutes hooks", () => {
    const dependencies = createTestDependencies();
    const routes = buildWebModuleRoutes(dependencies, { clearRegistry: true });

    expect(typeof routes["/organizations"]).toBe("function");
  });
});
