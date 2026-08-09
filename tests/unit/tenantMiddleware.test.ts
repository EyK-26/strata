import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
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

  test("skips tenant database scoping when TENANCY_DRIVER=none", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";

    try {
      const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
      const middleware = createTenantMiddleware();

      const response = await middleware(new Request("http://example.test/notes"), async () =>
        Response.json({ ok: true }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previous);
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

  test("uses the member account tenant when no header is sent", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();

    await runWithAuthUser({ id: 2, role: "member" }, async () => {
      const response = await middleware(new Request("http://example.test/tasks"), async () =>
        Response.json({ ok: true }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-tenant-id")).toBe("1");
    });
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

  test("uses the admin account tenant when no override header is sent", async () => {
    const { createTenantMiddleware } = await import("@getstrata/core/tenant/tenantMiddleware");
    const middleware = createTenantMiddleware();

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      const response = await middleware(new Request("http://example.test/tasks"), async () =>
        Response.json({ ok: true }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-tenant-id")).toBe("1");
    });
  });

  test("falls back to the default tenant when an admin header tenant is missing", async () => {
    const { createTenantMiddleware, DEFAULT_TENANT } = await import(
      "@getstrata/core/tenant/tenantMiddleware"
    );
    const middleware = createTenantMiddleware();

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      const response = await middleware(
        new Request("http://example.test/tasks", {
          headers: { "x-tenant-id": "999" },
        }),
        async () => Response.json({ ok: true }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-tenant-id")).toBe(String(DEFAULT_TENANT.id));
    });
  });

  test("falls back to the default tenant when a public-read guest header tenant is missing", async () => {
    const previous = process.env.FEATURE_PUBLIC_READS;
    process.env.FEATURE_PUBLIC_READS = "true";

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

  test("falls back to the default tenant when a member account tenant is missing", async () => {
    const { createTenantMiddleware, DEFAULT_TENANT } = await import(
      "@getstrata/core/tenant/tenantMiddleware"
    );
    const middleware = createTenantMiddleware();
    const email = `ghost-member-${Date.now()}@strata.test`;

    const userId = await runWithMigrationBypass(async () => {
      await db`SET session_replication_role = replica`;
      try {
        const rows = (await db`
          INSERT INTO users (name, email, email_lookup, role, tenant_id, password_hash)
          VALUES ('Ghost Member', ${email}, ${email}, 'member', 99999, 'x')
          RETURNING id
        `) as Array<{ id: number }>;
        return rows[0]?.id;
      } finally {
        await db`SET session_replication_role = origin`;
      }
    });

    if (typeof userId !== "number") {
      throw new Error("expected inserted member id");
    }

    try {
      await runWithAuthUser({ id: userId, role: "member" }, async () => {
        const response = await middleware(new Request("http://example.test/tasks"), async () =>
          Response.json({ ok: true }),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("x-tenant-id")).toBe(String(DEFAULT_TENANT.id));
      });
    } finally {
      await runWithMigrationBypass(async () => {
        await db`DELETE FROM users WHERE id = ${userId}`;
      });
    }
  });

  test("falls back to the default tenant when an admin account tenant is missing", async () => {
    const { createTenantMiddleware, DEFAULT_TENANT } = await import(
      "@getstrata/core/tenant/tenantMiddleware"
    );
    const middleware = createTenantMiddleware();
    const email = `ghost-admin-${Date.now()}@strata.test`;

    const userId = await runWithMigrationBypass(async () => {
      await db`SET session_replication_role = replica`;
      try {
        const rows = (await db`
          INSERT INTO users (name, email, email_lookup, role, tenant_id, password_hash)
          VALUES ('Ghost Admin', ${email}, ${email}, 'admin', 99999, 'x')
          RETURNING id
        `) as Array<{ id: number }>;
        return rows[0]?.id;
      } finally {
        await db`SET session_replication_role = origin`;
      }
    });

    if (typeof userId !== "number") {
      throw new Error("expected inserted admin id");
    }

    try {
      await runWithAuthUser({ id: userId, role: "admin" }, async () => {
        const response = await middleware(new Request("http://example.test/tasks"), async () =>
          Response.json({ ok: true }),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("x-tenant-id")).toBe(String(DEFAULT_TENANT.id));
      });
    } finally {
      await runWithMigrationBypass(async () => {
        await db`DELETE FROM users WHERE id = ${userId}`;
      });
    }
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

  test("resolveUserTenantId skips the users table when TENANCY_DRIVER=none", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";

    try {
      const { resolveUserTenantId, DEFAULT_TENANT } = await import(
        "@getstrata/core/tenant/tenantMiddleware"
      );

      await expect(resolveUserTenantId(1)).resolves.toBe(DEFAULT_TENANT.id);
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
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
