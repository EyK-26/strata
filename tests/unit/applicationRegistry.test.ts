import { describe, expect, test } from "bun:test";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "../../src/bootstrap/config";
import { type AppDependencies, ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import { getRequiredDependency } from "../../src/core/contracts/applicationContext";
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

  const auth = { resolve: async () => ({ id: 1, role: "admin", abilities: ["*"] }) };
  const policyGate = { allows: () => true };
  const queue = { dispatch: async () => undefined };

  container.set(CORE_AUTH_TOKEN, auth);
  container.set(CORE_POLICY_GATE_TOKEN, policyGate);
  container.set(CORE_QUEUE_TOKEN, queue);

  const dependencies = {
    container,
    cache,
    storage: {},
  } as AppDependencies;

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
    expect(resolveApplicationConfig().get<string>("app.name")).toBe("workhub");
    expect(resolveApplicationDependencies()).toBe(context.dependencies);
    expect(typeof resolveApplicationLogger().info).toBe("function");

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
    const cache = createTestContext().cache;

    expect(getRequiredDependency({ cache }, "cache")).toBe(cache);
    clearApplicationContext();
  });

  test("getRequiredDependency throws for missing dependencies", () => {
    expect(() => getRequiredDependency({}, "cache")).toThrow(
      'Required dependency "cache" is not registered.',
    );
  });
});
