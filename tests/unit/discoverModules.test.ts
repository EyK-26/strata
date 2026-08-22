import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  configureModulesDirectory,
  discoverModules,
  ensureModulesLoaded,
  resetDiscoverModulesForTests,
} from "@getstrata/bootstrap/discoverModules";

describe("discoverModules", () => {
  beforeAll(async () => {
    await ensureModulesLoaded();
  });

  test("discovers WorkHub modules in route priority order", () => {
    const modules = discoverModules();
    const orders = modules.map((module) => module.order ?? 100);

    expect(orders).toEqual([...orders].sort((left, right) => left - right));
    expect(modules.map((module) => module.name)).toEqual([
      "scim",
      "user",
      "admin",
      "organization",
      "project",
      "comment",
      "task",
      "attachment",
      "report",
      "audit",
      "webhook",
      "search",
      "billing",
    ]);
  });

  test("returns modules that expose routes or providers", () => {
    const modules = discoverModules();

    expect(modules.every((module) => module.name.length > 0)).toBe(true);
    expect(modules.some((module) => module.routes !== undefined)).toBe(true);
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
      configureModulesDirectory(join(import.meta.dir, "../../src/modules"));
      await ensureModulesLoaded();
    }
  });
});
