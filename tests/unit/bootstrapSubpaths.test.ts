import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const BOOTSTRAP_DIST = join(process.cwd(), "packages/strata-bootstrap/dist");

describe("@getstrata/bootstrap published subpaths", () => {
  test("web/routing exports route helpers", async () => {
    const routing = await import(join(BOOTSTRAP_DIST, "entries/web/routing.js"));

    expect(typeof routing.routeParams).toBe("function");
    expect(typeof routing.createRouteKernel).toBe("function");
    expect(typeof routing.wrapSecuredRouteModelByKey).toBe("function");
  });

  test("web/forms exports parseFormBody", async () => {
    const forms = await import(join(BOOTSTRAP_DIST, "entries/web/forms.js"));

    expect(typeof forms.parseFormBody).toBe("function");
  });

  test("cache/modelCacheTags exports tag helpers", async () => {
    const tags = await import(join(BOOTSTRAP_DIST, "entries/cache/modelCacheTags.js"));

    expect(typeof tags.cacheTagsForModelWrite).toBe("function");
    expect(typeof tags.discoverModelTableNames).toBe("function");
  });

  test("routeRegistry exports shared singleton", async () => {
    const first = await import(join(BOOTSTRAP_DIST, "entries/routeRegistry.js"));
    const second = await import(join(BOOTSTRAP_DIST, "entries/routeRegistry.js"));

    first.routeRegistry.register({ method: "GET", path: "/loop-17", middleware: [] });
    const paths = second.routeRegistry.list().map((route: { path: string }) => route.path);
    expect(paths).toContain("/loop-17");
    expect(first.routeRegistry).toBe(second.routeRegistry);
    second.routeRegistry.clear();
  });

  test("dependencies exports createAppDependencies", async () => {
    const dependencies = await import(join(BOOTSTRAP_DIST, "entries/dependencies.js"));

    expect(typeof dependencies.createAppDependencies).toBe("function");
    expect(typeof dependencies.createAppContext).toBe("function");
  });

  test("secretsGuard exports assertProductionSecrets without app domain or config", async () => {
    const secretsGuard = await import(join(BOOTSTRAP_DIST, "entries/secretsGuard.js"));
    const source = await readFile(join(BOOTSTRAP_DIST, "entries/secretsGuard.js"), "utf8");

    expect(typeof secretsGuard.assertProductionSecrets).toBe("function");
    expect(source).not.toContain("src/domain");
    expect(source).not.toContain("src/config");
  });

  test("discoverModules exports discovery helpers", async () => {
    const discover = await import(join(BOOTSTRAP_DIST, "entries/discoverModules.js"));

    expect(typeof discover.configureModulesDirectory).toBe("function");
    expect(typeof discover.ensureModulesLoaded).toBe("function");
    expect(typeof discover.discoverModules).toBe("function");
  });

  test("buildModuleRoutes exports module route builder", async () => {
    const routes = await import(join(BOOTSTRAP_DIST, "entries/buildModuleRoutes.js"));

    expect(typeof routes.buildModuleRoutes).toBe("function");
  });

  test("buildWebModuleRoutes exports web module route builder", async () => {
    const routes = await import(join(BOOTSTRAP_DIST, "entries/buildWebModuleRoutes.js"));

    expect(typeof routes.buildWebModuleRoutes).toBe("function");
  });

  test("contracts types re-export @getstrata/core without duplicating container classes", async () => {
    const contractsTypes = await readFile(join(BOOTSTRAP_DIST, "bootstrap/contracts.d.ts"), "utf8");

    expect(contractsTypes).toContain("@getstrata/core/contracts/container");
    expect(contractsTypes).toContain("@getstrata/core/contracts/di");
    await expect(access(join(BOOTSTRAP_DIST, "core"))).rejects.toThrow();
  });
});
