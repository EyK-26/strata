import { describe, expect, test } from "bun:test";
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

  test("secretsGuard exports assertProductionSecrets", async () => {
    const secretsGuard = await import(join(BOOTSTRAP_DIST, "entries/secretsGuard.js"));

    expect(typeof secretsGuard.assertProductionSecrets).toBe("function");
  });
});
