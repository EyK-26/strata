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

  test("main and mysqlConnection subpath share createMysqlPool", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const subpath = await import(join(CORE_DIST, "entries/database/mysqlConnection.js"));

    expect(main.createMysqlPool).toBe(subpath.createMysqlPool);
    expect(main.createMysqlConnection).toBe(subpath.createMysqlConnection);
    expect(main.createMysqlConnectionFromPool).toBe(subpath.createMysqlConnectionFromPool);
    expect(main.resetMysqlLoaderForTests).toBe(subpath.resetMysqlLoaderForTests);
  });

  test("main and view subpath share configureWebErrorView", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const subpath = await import(join(CORE_DIST, "entries/view.js"));

    expect(main.configureWebErrorView).toBe(subpath.configureWebErrorView);
  });

  test("shared shims keep subpath-only helpers reachable at runtime", async () => {
    const main = await import(join(CORE_DIST, "index.js"));
    const safeUrl = await import(join(CORE_DIST, "entries/security/safeUrl.js"));
    const webError = await import(join(CORE_DIST, "entries/http/webErrorResponse.js"));
    const loginThrottle = await import(join(CORE_DIST, "entries/http/loginThrottleMiddleware.js"));
    const view = await import(join(CORE_DIST, "entries/view.js"));

    expect(typeof safeUrl.assertSafeOutboundUrl).toBe("function");
    expect(typeof safeUrl.assertSafeOutboundUrlResolved).toBe("function");
    expect(typeof safeUrl.isBlockedHostname).toBe("function");
    expect(typeof safeUrl.isBlockedIpAddress).toBe("function");
    expect(safeUrl.assertSafeOutboundUrl).toBe(main.assertSafeOutboundUrl);

    expect(typeof webError.webErrorResponse).toBe("function");
    expect(typeof webError.logServerError).toBe("function");
    expect(typeof webError.normalizeFieldErrors).toBe("function");
    expect(webError.webErrorResponse).toBe(main.webErrorResponse);

    expect(typeof loginThrottle.resolveLoginIdentity).toBe("function");
    expect(typeof loginThrottle.resolveLoginEmail).toBe("function");
    expect(typeof loginThrottle.createMemoryLoginThrottleMiddleware).toBe("function");
    expect(loginThrottle.resolveLoginIdentity).toBe(main.resolveLoginIdentity);

    expect(typeof view.renderWebErrorHtml).toBe("function");
    expect(view.renderWebErrorHtml).toBe(main.renderWebErrorHtml);
  });
});
