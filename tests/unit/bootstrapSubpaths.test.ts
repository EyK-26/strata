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
});
