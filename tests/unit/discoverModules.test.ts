import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createModuleDiscovery, ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";

const FIXTURE_MODULES = join(import.meta.dir, "../fixtures/discover-modules");
const EMPTY_MODULES = join(import.meta.dir, "../fixtures/empty-modules");

describe("discoverModules", () => {
  test("discovers fixture modules in route priority order", async () => {
    const modules = await ensureModulesLoaded({ modulesDir: FIXTURE_MODULES });
    expect(modules.map((module) => module.order ?? 100)).toEqual([5, 10, 20]);
    expect(modules.map((module) => module.name)).toEqual(["organization", "pages", "reports"]);
    expect(Object.isFrozen(modules)).toBe(true);
  });

  test("returns modules that expose routes or web routes", async () => {
    const modules = await ensureModulesLoaded({ modulesDir: FIXTURE_MODULES });
    expect(modules.every((module) => module.name.length > 0)).toBe(true);
    expect(modules.some((module) => module.routes !== undefined)).toBe(true);
    expect(modules.some((module) => module.webRoutes !== undefined)).toBe(true);
  });

  test("independent application owners retain their results when another loads", async () => {
    const appA = createModuleDiscovery({ modulesDir: FIXTURE_MODULES });
    const pendingA = appA.load();
    const appB = createModuleDiscovery({ modulesDir: EMPTY_MODULES });
    const pendingB = appB.load();
    expect(appA.load()).toBe(pendingA);
    const [modulesA, modulesB] = await Promise.all([pendingA, pendingB]);
    expect(modulesA.map((module) => module.name)).toEqual(["organization", "pages", "reports"]);
    expect(modulesB).toEqual([]);
    const appC = createModuleDiscovery({ manifest: [{ name: "third" }] });
    expect(await appC.load()).toEqual([{ name: "third" }]);
    expect(await appA.load()).toBe(modulesA);
    expect(modulesA.map((module) => module.name)).toEqual(["organization", "pages", "reports"]);
    expect(await appB.load()).toBe(modulesB);
  });

  test("an owner captures manifest membership before discovery starts", async () => {
    const manifest = [{ name: "original" }];
    const discovery = createModuleDiscovery({ manifest });
    manifest.splice(0, 1, { name: "replacement" });
    const modules = await discovery.load();
    expect(modules.map((module) => module.name)).toEqual(["original"]);
    expect(() => (modules as Array<unknown>).push({ name: "injected" })).toThrow();
    expect(await discovery.load()).toBe(modules);
  });

  test("requires an explicit source", async () => {
    await expect(ensureModulesLoaded({})).rejects.toThrow("explicit modulesDir or manifest");
  });
});
