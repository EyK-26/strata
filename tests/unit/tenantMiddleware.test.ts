import { describe, expect, test } from "bun:test";
import { HttpError } from "@getstrata/core/errors/http";
import { errorResponse } from "@getstrata/core/http/response";
import { currentTenant, type TenantContext } from "@getstrata/core/tenant/tenantContext";
import {
  auditChecksum,
  createTenantMiddleware,
  DEFAULT_TENANT,
  resolveTenantForRequest,
  type TenantMiddlewareOptions,
} from "@getstrata/core/tenant/tenantMiddleware";

function options(overrides: Partial<TenantMiddlewareOptions> = {}): TenantMiddlewareOptions {
  return {
    auth: { user: null, credentialSource: null },
    config: { enabled: true, production: false, allowDevHeaders: false },
    resolveTenant: async (id) => (id === 1 ? DEFAULT_TENANT : null),
    userTenantId: async () => 1,
    ...overrides,
  };
}
async function run(
  configuration: TenantMiddlewareOptions,
  headers: Record<string, string> = {},
  path = "/tasks",
): Promise<{ tenant: TenantContext | null; response: Response }> {
  let tenant: TenantContext | null = null;
  const request = new Request(`http://example.test${path}`, { headers });
  let response: Response;
  try {
    response = await createTenantMiddleware(configuration)(request, async () => {
      tenant = currentTenant();
      return Response.json({ ok: true });
    });
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    response = errorResponse(error);
  }
  return { tenant, response };
}
describe("explicit tenant metadata admission", () => {
  test("default tenant contains only identity and anonymous headers cannot change it", async () => {
    expect(DEFAULT_TENANT).toEqual({ id: 1, slug: "default" });
    const result = await run(options(), { "x-tenant-id": "999", "x-tenant-plan": "paid" });
    expect(result.tenant).toEqual(DEFAULT_TENANT);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("x-tenant-id")).toBeNull();
    expect(currentTenant()).toBeNull();
  });
  test("loads trusted metadata only for selected identity and rejects resolver identity changes", async () => {
    const selected: number[] = [];
    const result = await run(
      options({
        resolveTenant: async (id) => {
          selected.push(id);
          return { id, slug: "custom", metadata: { entitlement: "campus" } };
        },
      }),
      { "x-tenant-id": "999", "x-entitlement": "other" },
    );
    expect(selected).toEqual([1]);
    expect(result.tenant).toEqual({ id: 1, slug: "custom", metadata: { entitlement: "campus" } });
    await expect(
      run(options({ resolveTenant: async () => ({ id: 999, slug: "wrong" }) })),
    ).rejects.toThrow("different tenant identity");
  });
  test("disabled tenancy supplies default identity without database lookups", async () => {
    const configuration = options({
      config: { enabled: false, production: false, allowDevHeaders: false },
      resolveTenant: async () => {
        throw new Error("must not query");
      },
      userTenantId: async () => {
        throw new Error("must not query");
      },
    });
    const result = await run(configuration, { "x-tenant-id": "999" });
    expect(result.response.status).toBe(200);
    expect(result.tenant).toEqual(DEFAULT_TENANT);
  });
  test("SCIM pathname alone does not bypass ordinary tenant admission", async () => {
    const result = await run(options({ resolveTenant: async () => null }), {}, "/scim/v2/Users");
    expect(result.response.status).toBe(403);
    expect(result.tenant).toBeNull();
  });
  for (const role of ["member", "admin"] as const) {
    test(`${role} uses established account tenant without a header`, async () => {
      const lookedUp: number[] = [];
      const result = await run(
        options({
          auth: { user: { id: 42, role }, credentialSource: "bearer" },
          userTenantId: async (id) => {
            lookedUp.push(id);
            return 7;
          },
          resolveTenant: async (id) => ({ id, slug: "account" }),
        }),
      );
      expect(lookedUp).toEqual([42]);
      expect(result.response.status).toBe(200);
      expect(result.tenant?.id).toBe(7);
    });
    test(`${role} missing account tenant is denied instead of selecting a different tenant`, async () => {
      const result = await run(
        options({
          auth: { user: { id: 42, role }, credentialSource: "session" },
          userTenantId: async () => 99999,
        }),
      );
      expect(result.response.status).toBe(403);
      expect(result.tenant).toBeNull();
    });
  }
  test("member mismatched headers return a private denial before handler", async () => {
    const result = await run(
      options({ auth: { user: { id: 2, role: "member" }, credentialSource: "bearer" } }),
      { "x-tenant-id": "999" },
    );
    expect(result.tenant).toBeNull();
    expect(result.response.status).toBe(403);
    expect(result.response.headers.get("cache-control")).toBe("no-store");
    expect(await result.response.json()).toEqual({
      error: "Tenant header does not match your account.",
    });
  });
  test("global admins can select an existing header tenant but cannot fall back from a missing one", async () => {
    const configuration = options({
      auth: { user: { id: 1, role: "admin" }, credentialSource: "bearer" },
      resolveTenant: async (id) => (id === 7 ? { id, slug: "selected" } : null),
    });
    expect((await run(configuration, { "x-tenant-id": "7" })).tenant?.id).toBe(7);
    const missing = await run(configuration, { "x-tenant-id": "999" });
    expect(missing.response.status).toBe(403);
    expect(missing.tenant).toBeNull();
  });
  test("explicit development headers require an existing tenant", async () => {
    const configuration = options({
      config: { enabled: true, production: false, allowDevHeaders: true },
      resolveTenant: async (id) => (id === 7 ? { id, slug: "dev" } : null),
    });
    expect((await run(configuration, { "x-tenant-id": "7" })).tenant?.id).toBe(7);
    expect((await run(configuration, { "x-tenant-id": "999" })).response.status).toBe(403);
  });
  test("guest guard identifiers are never queried as persisted accounts", async () => {
    const result = await run(
      options({
        auth: { user: { id: 777, role: "member" }, credentialSource: "guest" },
        userTenantId: async () => {
          throw new Error("must not query");
        },
      }),
    );
    expect(result.tenant).toEqual(DEFAULT_TENANT);
  });
  test("invalid principal ids never trigger a database lookup", async () => {
    const result = await run(
      options({
        auth: { user: { id: "invalid", role: "member" }, credentialSource: "bearer" },
        userTenantId: async () => {
          throw new Error("must not query");
        },
      }),
    );
    expect(result.tenant).toEqual(DEFAULT_TENANT);
  });
  test("audit checksum is a stable SHA256 digest", () => {
    expect(auditChecksum({ action: "login" })).toMatch(/^[a-f0-9]{64}$/);
    expect(auditChecksum({ action: "login" })).toBe(auditChecksum({ action: "login" }));
  });
  test("non-http handler errors propagate to the outer response boundary", async () => {
    await expect(
      createTenantMiddleware(options())(new Request("http://example.test"), async () => {
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
  });
});

for (const selected of ["member", "admin", "admin-header", "anonymous-default"] as const) {
  test(`direct tenant resolution refuses missing ${selected} identity without fallback or consumer admission`, async () => {
    const accountLookups: number[] = [];
    const resolutions: number[] = [];
    let consumers = 0;
    const configuration = options({
      auth:
        selected === "anonymous-default"
          ? { user: null, credentialSource: null }
          : {
              user: { id: 42, role: selected === "member" ? "member" : "admin" },
              credentialSource: "session",
            },
      userTenantId: async (id) => {
        accountLookups.push(id);
        return 7;
      },
    });
    const request = new Request("http://example.test/tasks", {
      headers: selected === "admin-header" ? { "x-tenant-id": "9" } : {},
    });
    await expect(
      resolveTenantForRequest(request, configuration, async (id) => {
        resolutions.push(id);
        return null;
      }).then((tenant) => {
        consumers++;
        return tenant;
      }),
    ).rejects.toThrow("Tenant not found.");
    expect(resolutions).toEqual([
      selected === "admin-header" ? 9 : selected === "anonymous-default" ? 1 : 7,
    ]);
    expect(accountLookups).toEqual(selected === "anonymous-default" ? [] : [42]);
    expect(consumers).toBe(0);
    expect(currentTenant()).toBeNull();
  });
}
