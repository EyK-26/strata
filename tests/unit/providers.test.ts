import { describe, expect, test } from "bun:test";
import {
  APP_PORT_CONFIG_KEY,
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  CORE_CACHE_TOKEN,
} from "../../src/bootstrap/config";
import {
  ConfigStore,
  ServiceContainer,
} from "../../src/bootstrap/contracts";
import { createAppContext } from "../../src/bootstrap/dependencies";

describe("service container", () => {
  test("memoizes singleton services and creates transient bindings", () => {
    const container = new ServiceContainer();

    container.singleton("singleton", () => ({ marker: Symbol("singleton") }));
    container.bind("transient", () => ({ marker: Symbol("transient") }));

    const singletonA = container.resolve<{ marker: symbol }>("singleton");
    const singletonB = container.resolve<{ marker: symbol }>("singleton");
    const transientA = container.resolve<{ marker: symbol }>("transient");
    const transientB = container.resolve<{ marker: symbol }>("transient");

    expect(singletonA).toBe(singletonB);
    expect(transientA).not.toBe(transientB);
    expect(container.has("singleton")).toBe(true);
    expect(container.has("transient")).toBe(true);
  });
});

describe("config store", () => {
  test("stores and requires config values", () => {
    const config = new ConfigStore();

    config.set("app.name", "BunTesting");

    expect(config.get<string>("app.name")).toBe("BunTesting");
    expect(config.require<string>("app.name")).toBe("BunTesting");
    expect(() => config.require("missing.key")).toThrow(
      'Config key "missing.key" is not defined.',
    );
  });
});

describe("app providers", () => {
  test("build the app context from config and core providers", () => {
    const previousPort = process.env.PORT;
    const previousTtl = process.env.CACHE_TTL_MS;
    const previousMaxEntries = process.env.CACHE_MAX_ENTRIES;

    process.env.PORT = "4100";
    process.env.CACHE_TTL_MS = "2500";
    process.env.CACHE_MAX_ENTRIES = "25";

    try {
      const context = createAppContext();

      expect(context.config.require<number>(APP_PORT_CONFIG_KEY)).toBe(4100);
      expect(context.config.require<number>(CACHE_TTL_MS_CONFIG_KEY)).toBe(2500);
      expect(context.config.require<number>(CACHE_MAX_ENTRIES_CONFIG_KEY)).toBe(25);
      expect(context.dependencies.cache).toBe(
        context.container.resolve(CORE_CACHE_TOKEN),
      );
      expect(context.dependencies.characterRepository).toBeDefined();
      expect(context.dependencies.statisticsService).toBeDefined();
      expect(context.dependencies.jsonTreeService).toBeDefined();
    } finally {
      process.env.PORT = previousPort;
      process.env.CACHE_TTL_MS = previousTtl;
      process.env.CACHE_MAX_ENTRIES = previousMaxEntries;
    }
  });
});
