import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { buildRequestCacheKey } from "@getstrata/core/http/validation";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";

describe("buildRequestCacheKey", () => {
  test("includes auth and tenant scopes in cache keys", () => {
    const request = new Request("http://example.test/projects?page=1");

    const guestKey = buildRequestCacheKey("/projects", request);
    expect(guestKey).toBe("guest|t:none|/projects?page=1");

    const guestTenantKey = runWithTenant(
      { id: 4, slug: "public", plan: "free", region: "us" },
      () => buildRequestCacheKey("/projects", request),
    );
    expect(guestTenantKey).toBe("guest|t:4|/projects?page=1");

    const memberKey = runWithAuthUser({ id: 2, role: "member", abilities: [] }, () =>
      runWithTenant({ id: 3, slug: "isolated", plan: "free", region: "us" }, () =>
        buildRequestCacheKey("/projects", request),
      ),
    );

    expect(memberKey).toBe("u:2|t:3|/projects?page=1");
  });
});
