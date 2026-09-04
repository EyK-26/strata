import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  configureModulesDirectory,
  discoverModules,
  ensureModulesLoaded,
  resetDiscoverModulesForTests,
} from "@getstrata/bootstrap/discoverModules";

const FIXTURE_MODULES = join(import.meta.dir, "../fixtures/discover-modules");
const EMPTY_MODULES = join(import.meta.dir, "../fixtures/empty-modules");

describe("discoverModules", () => {
  beforeAll(async () => {
    resetDiscoverModulesForTests();
    configureModulesDirectory(FIXTURE_MODULES);
    await ensureModulesLoaded();
  });

  afterEach(() => {
    resetDiscoverModulesForTests();
    configureModulesDirectory(EMPTY_MODULES);
  });

  test("discovers fixture modules in route priority order", async () => {
    resetDiscoverModulesForTests();
    configureModulesDirectory(FIXTURE_MODULES);
    await ensureModulesLoaded();

    const modules = discoverModules();
    const orders = modules.map((module) => module.order ?? 100);

    expect(orders).toEqual([...orders].sort((left, right) => left - right));
    expect(modules.map((module) => module.name)).toEqual(["organization", "pages", "reports"]);
  });

  test("returns modules that expose routes or web routes", async () => {
    resetDiscoverModulesForTests();
    configureModulesDirectory(FIXTURE_MODULES);
    await ensureModulesLoaded();

    const modules = discoverModules();

    expect(modules.every((module) => module.name.length > 0)).toBe(true);
    expect(modules.some((module) => module.routes !== undefined)).toBe(true);
    expect(modules.some((module) => module.webRoutes !== undefined)).toBe(true);
  });

  test("reloads when the configured modules directory changes", async () => {
    resetDiscoverModulesForTests();
    configureModulesDirectory(EMPTY_MODULES);
    await ensureModulesLoaded();
    expect(discoverModules()).toEqual([]);

    configureModulesDirectory(FIXTURE_MODULES);
    await ensureModulesLoaded();
    expect(discoverModules().map((module) => module.name)).toEqual([
      "organization",
      "pages",
      "reports",
    ]);
  });

  test("requires an explicit modules directory", async () => {
    resetDiscoverModulesForTests();

    try {
      await ensureModulesLoaded();
      throw new Error("expected configureModulesDirectory to be required");
    } catch (error) {
      expect((error as Error).message).toMatch(/configureModulesDirectory/);
    } finally {
      resetDiscoverModulesForTests();
      configureModulesDirectory(EMPTY_MODULES);
      await ensureModulesLoaded();
    }
  });
});
