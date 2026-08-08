import { describe, expect, test } from "bun:test";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "../../src/bootstrap/config";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import { createRoutes } from "../../src/bootstrap/createRoutes";
import type { AppDependencies } from "../../src/bootstrap/dependencies";
import { appConfig } from "../../src/config/app";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { PolicyGate } from "../../src/core/auth/policy";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { SyncQueue } from "../../src/core/queue";
import { reportServiceToken } from "../../src/modules/report/provider";
import { tokenServiceToken } from "../../src/modules/user/provider";

function normalizeJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

function createTestDependencies() {
  const summary = {
    organization_count: 2,
    project_count: 3,
    task_count: 4,
    comment_count: 4,
    projects_by_status: { active: 2, draft: 1 },
    tasks_by_status: { done: 1, in_progress: 2, todo: 1 },
  };

  const calls = { summary: 0 };

  const dependencies: AppDependencies = {
    container: new ServiceContainer(),
    cache: new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
  };

  dependencies.container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  dependencies.container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  dependencies.container.set(CORE_QUEUE_TOKEN, new SyncQueue());
  dependencies.container.set(tokenServiceToken, {
    requireAbility: () => undefined,
    tokenCan: () => true,
  });
  dependencies.container.set(reportServiceToken, {
    getSummary: async () => {
      calls.summary += 1;
      return summary;
    },
    getOrganizationReport: async (id: number) => ({
      organization: { id, name: "Acme Labs", slug: "acme-labs" },
      project_count: 2,
      task_count: 2,
      comment_count: 2,
      projects_by_status: { active: 1, draft: 1 },
      tasks_by_status: { done: 1, in_progress: 1 },
    }),
  });

  return { dependencies, calls, summary };
}

describe("routes", () => {
  test("caches the report summary response", async () => {
    const { dependencies, calls, summary } = createTestDependencies();
    const routes = createRoutes(dependencies);

    const summaryPath = `${appConfig.apiPrefix}/reports/summary`;
    const firstResponse = await routes[summaryPath](
      new Request(`http://example.test${summaryPath}`),
    );
    const secondResponse = await routes[summaryPath](
      new Request(`http://example.test${summaryPath}`),
    );

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual(normalizeJson(summary));
    expect(await secondResponse.json()).toEqual(normalizeJson(summary));
    expect(calls.summary).toBe(1);
  });

  test("returns 404 for unknown paths", async () => {
    const { dependencies } = createTestDependencies();
    const routes = createRoutes(dependencies);

    const response = await routes["/*"](new Request("http://example.test/unknown"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
  });
});
