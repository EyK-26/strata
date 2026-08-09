import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "../../src/core/auth/authContext";
import { buildRequestCacheKey } from "../../src/core/http/validation";
import { runWithTenant } from "../../src/core/tenant/tenantContext";

describe("buildRequestCacheKey", () => {
  test("includes auth and tenant scopes in cache keys", () => {
    const request = new Request("http://example.test/projects?page=1");

    const guestKey = buildRequestCacheKey("/projects", request);
    expect(guestKey).toBe("guest|t:1|/projects?page=1");

    const memberKey = runWithAuthUser({ id: 2, role: "member", abilities: [] }, () =>
      runWithTenant({ id: 3, slug: "isolated", plan: "free", region: "us" }, () =>
        buildRequestCacheKey("/projects", request),
      ),
    );

    expect(memberKey).toBe("u:2|t:3|/projects?page=1");
  });
});
