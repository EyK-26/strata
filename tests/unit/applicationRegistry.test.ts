import { describe, expect, test } from "bun:test";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "../../src/bootstrap/config";
import { ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import type { AuthUser } from "../../src/core/auth/guard";
import type { PolicyGate } from "../../src/core/auth/policy";
import { getRequiredDependency } from "../../src/core/contracts/applicationContext";
import type { Queue } from "../../src/core/queue";
import {
  resetApplicationContextForTests,
  resolveApplicationAuth,
  resolveApplicationCache,
  resolveApplicationConfig,
  resolveApplicationDependencies,
  resolveApplicationLogger,
  resolveApplicationPolicyGate,
  resolveApplicationQueue,
  setActiveApplicationContext,
} from "../../src/core/runtime/applicationRegistry";

function clearApplicationContext(): void {
  resetApplicationContextForTests();
}

function createTestContext() {
  const container = new ServiceContainer();
  const config = new ConfigStore();
  config.set("app.name", "workhub");

  const cache = {
    remember: async (_key: string, callback: () => Promise<unknown>) => callback(),
    tags: () => ({
      remember: async (_key: string, callback: () => Promise<unknown>) => callback(),
      flush: async () => 0,
    }),
  };

  const authUser: AuthUser = { id: 1, role: "admin", abilities: ["*"] };
  const auth = { resolve: async () => authUser };
  const policyGate = { allows: () => true } as PolicyGate;
  const queue = { dispatch: async () => undefined } as Queue;

  container.set(CORE_AUTH_TOKEN, auth);
  container.set(CORE_POLICY_GATE_TOKEN, policyGate);
  container.set(CORE_QUEUE_TOKEN, queue);

  const dependencies = { container, cache, storage: {} };

  setActiveApplicationContext({ container, config, dependencies });

  return { auth, cache, config, dependencies, policyGate, queue };
}

describe("applicationRegistry", () => {
  test("resolves bootstrapped services from the active application context", () => {
    const context = createTestContext();

    expect(resolveApplicationCache()).toBe(context.cache);
    expect(resolveApplicationAuth()).toBe(context.auth);
    expect(resolveApplicationPolicyGate()).toBe(context.policyGate);
    expect(resolveApplicationQueue()).toBe(context.queue);
    expect(resolveApplicationConfig().get("app.name")).toBe("workhub");
    expect(resolveApplicationDependencies()).toBe(context.dependencies);
    expect(resolveApplicationLogger().channel).toBe("app");

    clearApplicationContext();
  });

  test("throws when the application context has not been bootstrapped", () => {
    clearApplicationContext();

    expect(() => resolveApplicationCache()).toThrow(
      "The application context has not been bootstrapped.",
    );
  });
});

describe("applicationContext helpers", () => {
  test("getRequiredDependency returns registered dependencies", () => {
    const cache = { remember: async () => undefined };

    expect(getRequiredDependency({ cache }, "cache")).toBe(cache);
  });

  test("getRequiredDependency throws for missing dependencies", () => {
    expect(() => getRequiredDependency({}, "cache")).toThrow(
      'Required dependency "cache" is not registered.',
    );
  });
});
