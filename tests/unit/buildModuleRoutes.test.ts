import { beforeAll, describe, expect, test } from "bun:test";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { buildModuleRoutes } from "../../src/bootstrap/buildModuleRoutes";
import { appConfig } from "../../src/config/app";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { PolicyGate } from "../../src/core/auth/policy";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { SyncQueue } from "../../src/core/queue";
import { reportServiceToken } from "../../src/modules/report/provider";
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
  dependencies.container.set(reportServiceToken, {
    getSummary: async () => ({
      organization_count: 0,
      project_count: 0,
      task_count: 0,
      comment_count: 0,
      projects_by_status: {},
      tasks_by_status: {},
    }),
    getOrganizationReport: async () => ({
      organization: { id: 1, name: "Acme", slug: "acme" },
      project_count: 0,
      task_count: 0,
      comment_count: 0,
      projects_by_status: {},
      tasks_by_status: {},
    }),
  });

  return dependencies;
}

describe("buildModuleRoutes", () => {
  beforeAll(async () => {
    await ensureModulesLoaded();
  });

  test("builds prefixed module routes from discovered modules", () => {
    const dependencies = createTestDependencies();
    const routes = buildModuleRoutes(dependencies, { apiPrefix: appConfig.apiPrefix });
    const summaryPath = `${appConfig.apiPrefix}/reports/summary`;

    expect(typeof routes[summaryPath]).toBe("function");
  });

  test("can append routes without clearing the OpenAPI registry", () => {
    const dependencies = createTestDependencies();
    const firstCount = buildModuleRoutes(dependencies, { apiPrefix: appConfig.apiPrefix });
    const secondCount = buildModuleRoutes(dependencies, {
      apiPrefix: appConfig.apiPrefix,
      clearRegistry: false,
    });

    expect(Object.keys(firstCount).length).toBeGreaterThan(0);
    expect(Object.keys(secondCount).length).toBeGreaterThan(0);
  });
});
