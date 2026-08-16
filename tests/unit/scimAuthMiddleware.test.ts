import { afterEach, describe, expect, test } from "bun:test";

const originalTenantTokens = process.env.SCIM_TENANT_TOKENS;
const originalBearerToken = process.env.SCIM_BEARER_TOKEN;

afterEach(() => {
  if (originalTenantTokens === undefined) {
    delete process.env.SCIM_TENANT_TOKENS;
  } else {
    process.env.SCIM_TENANT_TOKENS = originalTenantTokens;
  }

  if (originalBearerToken === undefined) {
    delete process.env.SCIM_BEARER_TOKEN;
  } else {
    process.env.SCIM_BEARER_TOKEN = originalBearerToken;
  }
});

describe("createScimAuthMiddleware", () => {
  test("rejects requests without bearer tokens", async () => {
    const { createScimAuthMiddleware } = await import("@getstrata/core/auth/scimAuthMiddleware");
    const middleware = createScimAuthMiddleware();

    const response = await middleware(new Request("http://example.test/scim/Users"), async () =>
      Response.json({ ok: true }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      detail: "SCIM bearer token required.",
    });
  });

  test("rejects invalid bearer tokens", async () => {
    const { createScimAuthMiddleware } = await import("@getstrata/core/auth/scimAuthMiddleware");
    const middleware = createScimAuthMiddleware();

    const response = await middleware(
      new Request("http://example.test/scim/Users", {
        headers: { authorization: "Bearer invalid-token" },
      }),
      async () => Response.json({ ok: true }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      detail: "Invalid SCIM bearer token.",
    });
  });

  test("rejects tokens mapped to missing tenants", async () => {
    process.env.SCIM_TENANT_TOKENS = "999:missing-tenant-token";

    const { createScimAuthMiddleware } = await import("@getstrata/core/auth/scimAuthMiddleware");
    const middleware = createScimAuthMiddleware();

    const response = await middleware(
      new Request("http://example.test/scim/Users", {
        headers: { authorization: "Bearer missing-tenant-token" },
      }),
      async () => Response.json({ ok: true }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      detail: "SCIM tenant not found.",
    });
  });

  test("runs the next handler within tenant scope for valid tokens", async () => {
    process.env.SCIM_TENANT_TOKENS = "1:valid-token";

    const { createScimAuthMiddleware } = await import("@getstrata/core/auth/scimAuthMiddleware");
    const middleware = createScimAuthMiddleware();
    let nextCalled = false;

    const response = await middleware(
      new Request("http://example.test/scim/Users", {
        headers: { authorization: "Bearer valid-token" },
      }),
      async () => {
        nextCalled = true;
        return Response.json({ ok: true });
      },
    );

    expect(nextCalled).toBe(true);
    expect(response.status).toBe(200);
  });

  test("scopes repository reads to the SCIM tenant transaction", async () => {
    process.env.SCIM_TENANT_TOKENS = "1:valid-token";

    const { createScimAuthMiddleware } = await import("@getstrata/core/auth/scimAuthMiddleware");
    const UserRepository = (await import("../../src/modules/user/repository")).default;
    const middleware = createScimAuthMiddleware();

    const response = await middleware(
      new Request("http://example.test/scim/v2/Users", {
        headers: { authorization: "Bearer valid-token" },
      }),
      async () => {
        const users = await new UserRepository().findAll({ where: { tenant_id: 1 } });
        return Response.json({ count: users.length });
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(2);
  });

  test("lists users through ScimService inside SCIM auth middleware", async () => {
    process.env.SCIM_TENANT_TOKENS = "1:valid-token";

    const { createScimAuthMiddleware } = await import("@getstrata/core/auth/scimAuthMiddleware");
    const OrganizationMemberRepository = (
      await import("../../src/modules/organization/memberRepository")
    ).default;
    const OrganizationRepository = (await import("../../src/modules/organization/repository"))
      .default;
    const ScimService = (await import("../../src/modules/scim/service")).default;
    const UserRepository = (await import("../../src/modules/user/repository")).default;
    const middleware = createScimAuthMiddleware();
    const service = new ScimService(
      new UserRepository(),
      new OrganizationRepository(),
      new OrganizationMemberRepository(),
    );

    const response = await middleware(
      new Request("http://example.test/scim/v2/Users?count=10", {
        headers: { authorization: "Bearer valid-token" },
      }),
      async () => {
        const list = await service.listUsers(1, 10);
        return Response.json(list);
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { totalResults: number };
    expect(body.totalResults).toBeGreaterThanOrEqual(2);
  });
});
