import { beforeAll, describe, expect, test } from "bun:test";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { PolicyGate } from "@getstrata/core/auth/policy";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { SyncQueue } from "@getstrata/core/queue";
import { tokenServiceToken } from "../../src/modules/user/provider";
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
  dependencies.container.set(tokenServiceToken, {
    requireAbility: () => undefined,
    tokenCan: () => true,
  });

  return dependencies;
}

describe("buildWebModuleRoutes", () => {
  beforeAll(async () => {
    await ensureModulesLoaded();
  });

  test("builds web routes from discovered module webRoutes hooks", () => {
    const dependencies = createTestDependencies();
    const routes = buildWebModuleRoutes(dependencies, { clearRegistry: true });

    expect(routes["/organizations"]).toBeDefined();
  });
});
