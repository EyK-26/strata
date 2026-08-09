import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CORE_DIST = join(process.cwd(), "packages/strata-core/dist");

describe("@getstrata/core published bundle singletons", () => {
  test("main and authContext subpath share currentAuthUser", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const subpath = await import(join(CORE_DIST, "entries/auth/authContext.js"));

    expect(main.currentAuthUser).toBe(subpath.currentAuthUser);
  });

  test("main and tenantContext subpath share currentTenantId", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const subpath = await import(join(CORE_DIST, "entries/tenant/tenantContext.js"));

    expect(main.currentTenantId).toBe(subpath.currentTenantId);
  });

  test("main and http subpath share securedBindRouteModel", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const subpath = await import(join(CORE_DIST, "entries/http.js"));

    expect(main.securedBindRouteModel).toBe(subpath.securedBindRouteModel);
  });

  test("main and membershipContext subpath share hasOrgMembership", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const subpath = await import(join(CORE_DIST, "entries/auth/membershipContext.js"));

    expect(main.hasOrgMembership).toBe(subpath.hasOrgMembership);
  });

  test("main and queue/jobRegistry subpath share jobRegistry", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const subpath = await import(join(CORE_DIST, "entries/queue/jobRegistry.js"));

    expect(main.jobRegistry).toBe(subpath.jobRegistry);
  });

  test("@getstrata/core workspace imports resolve through one tenantContext module", async () => {
    const main = await import("@getstrata/core");
    const subpath = await import("@getstrata/core/tenant/tenantContext");

    expect(main.currentTenantId).toBe(subpath.currentTenantId);
  });

  test("main and view subpath share configureWebErrorView", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const subpath = await import(join(CORE_DIST, "entries/view.js"));

    expect(main.configureWebErrorView).toBe(subpath.configureWebErrorView);
  });
});
