import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("createTenantMiddleware", () => {
  test("resolves tenant from header for anonymous requests", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();

    const response = await middleware(
      new Request("http://example.test/tasks", {
        headers: { "x-tenant-id": "1" },
      }),
      async () => Response.json({ ok: true }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tenant-id")).toBe("1");
    expect(response.headers.get("x-tenant-region")).toBeTruthy();
  });

  test("ignores anonymous x-tenant-id when public reads are disabled", async () => {
    const previous = process.env.FEATURE_PUBLIC_READS;
    process.env.FEATURE_PUBLIC_READS = "false";

    try {
      const { createTenantMiddleware, DEFAULT_TENANT } = await import(
        "@getstrata/core/tenant/tenantMiddleware"
      );
      const middleware = createTenantMiddleware();

      const response = await middleware(
        new Request("http://example.test/tasks", {
          headers: { "x-tenant-id": "999" },
        }),
        async () => Response.json({ ok: true }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-tenant-id")).toBe(String(DEFAULT_TENANT.id));
    } finally {
      restoreEnvVar("FEATURE_PUBLIC_READS", previous);
    }
  });

  test("defers SCIM routes to SCIM auth middleware for tenant scoping", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();
    let nextCalled = false;

    const response = await middleware(
      new Request("http://example.test/scim/v2/Users"),
      async () => {
        nextCalled = true;
        return Response.json({ ok: true });
      },
    );

    expect(nextCalled).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-tenant-id")).toBeNull();
  });

  test("uses the authenticated user tenant and rejects mismatched headers", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();

    await runWithAuthUser({ id: 2, role: "member" }, async () => {
      const response = await middleware(
        new Request("http://example.test/tasks", {
          headers: { "x-tenant-id": "999" },
        }),
        async () => Response.json({ ok: true }),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Tenant header does not match your account.",
      });
    });
  });

  test("allows global admins to override tenant via header", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      const response = await middleware(
        new Request("http://example.test/tasks", {
          headers: { "x-tenant-id": "1" },
        }),
        async () => Response.json({ ok: true }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-tenant-id")).toBe("1");
    });
  });

  test("falls back to default tenant for invalid user ids", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();

    await runWithAuthUser({ id: "invalid", role: "member" }, async () => {
      const response = await middleware(new Request("http://example.test/tasks"), async () =>
        Response.json({ ok: true }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-tenant-id")).toBe("1");
    });
  });

  test("auditChecksum returns a stable sha256 digest", async () => {
    const { auditChecksum } = await import("@getstrata/core/tenant/tenantMiddleware");

    expect(auditChecksum({ action: "login" })).toMatch(/^[a-f0-9]{64}$/);
    expect(auditChecksum({ action: "login" })).toBe(auditChecksum({ action: "login" }));
  });

  test("resolveUserTenantId returns the user tenant or default", async () => {
    const { resolveUserTenantId, DEFAULT_TENANT } = await import(
      "@getstrata/core/tenant/tenantMiddleware"
    );

    await expect(resolveUserTenantId(1)).resolves.toBe(1);
    await expect(resolveUserTenantId(999_999)).resolves.toBe(DEFAULT_TENANT.id);
  });

  test("maps forbidden errors to json responses", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();

    await runWithAuthUser({ id: 2, role: "member" }, async () => {
      const response = await middleware(
        new Request("http://example.test/tasks", {
          headers: { "x-tenant-id": "999" },
        }),
        async () => Response.json({ ok: true }),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Tenant header does not match your account.",
      });
    });
  });
});

describe("tenant middleware error propagation", () => {
  test("rethrows non-http errors from downstream handlers", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();

    await expect(
      middleware(new Request("http://example.test/tasks"), async () => {
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
  });
});
