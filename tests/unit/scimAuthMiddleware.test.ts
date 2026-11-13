import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createScimAuthMiddleware } from "@getstrata/core/auth/scimAuthMiddleware";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { currentTenantId, runWithTenant } from "@getstrata/core/tenant/tenantContext";

let app: ReturnType<typeof createApplication>;
beforeEach(async () => {
  app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  await app.start();
  await app.run(async (scope) => {
    const database = scope.resolve(DATABASE_SESSION_TOKEN).connection("main");
    await database.execute({
      text: "CREATE TABLE tenants (id INTEGER PRIMARY KEY, slug TEXT)",
      params: [],
    });
    await database.execute({ text: "INSERT INTO tenants VALUES (1, 'acme')", params: [] });
  });
});
afterEach(async () => {
  expect((await app.stop()).successful).toBe(true);
});

const middleware = createScimAuthMiddleware({
  resolveToken: (token) =>
    token === "valid-token" ? 1 : token === "missing-tenant-token" ? 999 : null,
  resolveTenant: async (database, id) => {
    const rows = await database.execute<{ id: number; slug: string }>({
      text: "SELECT id, slug FROM tenants WHERE id = ?",
      params: [id],
    });
    return rows[0] ?? null;
  },
});
function authenticate(request: Request) {
  return app.run((scope) =>
    middleware(request, scope.resolve(DATABASE_SESSION_TOKEN).connection("main")),
  );
}

describe("createScimAuthMiddleware explicit authenticator", () => {
  test("rejects requests without bearer tokens", async () => {
    const response = await authenticate(new Request("http://example.test/scim/Users"));
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected bearer rejection");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ detail: "SCIM bearer token required." });
  });
  test("rejects invalid bearer tokens", async () => {
    const response = await authenticate(
      new Request("http://example.test/scim/Users", {
        headers: { authorization: "Bearer invalid-token" },
      }),
    );
    if (!(response instanceof Response)) throw new Error("Expected invalid-token rejection");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ detail: "Invalid SCIM bearer token." });
  });
  test("rejects tokens mapped to missing tenants", async () => {
    const response = await authenticate(
      new Request("http://example.test/scim/Users", {
        headers: { authorization: "Bearer missing-tenant-token" },
      }),
    );
    if (!(response instanceof Response)) throw new Error("Expected missing-tenant rejection");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ detail: "SCIM tenant not found." });
  });
  test("returns the validated tenant before a consumer runs its next handler", async () => {
    const tenant = await authenticate(
      new Request("http://example.test/scim/Users", {
        headers: { authorization: "Bearer valid-token" },
      }),
    );
    if (tenant instanceof Response) throw new Error("Expected authenticated tenant");
    expect(tenant).toEqual({ id: 1, slug: "acme" });
    let nextCalled = false;
    const response = await runWithTenant(tenant, async () => {
      nextCalled = true;
      return Response.json({ ok: true });
    });
    expect(nextCalled).toBe(true);
    expect(response.status).toBe(200);
  });
  test("consumer contract establishes ALS only from the authenticated tenant result", async () => {
    const tenant = await authenticate(
      new Request("http://example.test/scim/v2/Users", {
        headers: { authorization: "Bearer valid-token" },
      }),
    );
    if (tenant instanceof Response) throw new Error("Expected authenticated tenant");
    const seen = await runWithTenant(tenant, () => currentTenantId());
    expect(seen).toBe(1);
    expect(() => currentTenantId()).toThrow("Tenant context is required.");
  });
});

test("SCIM tenant resolver mismatch rejects before consumer admission and preserves the surrounding tenant", async () => {
  const lookedUp: number[] = [];
  let queries = 0;
  let consumers = 0;
  const authenticate = createScimAuthMiddleware({
    resolveToken: (token) => (token === "fixture-token" ? 1 : null),
    resolveTenant: async (database, id) => {
      lookedUp.push(id);
      queries++;
      const [tenant] = await database.execute<{ id: number; slug: string }>({
        text: "SELECT id,slug FROM tenants WHERE id=?",
        params: [id],
      });
      if (!tenant) throw new Error("Missing fixture tenant");
      return { ...tenant, id: tenant.id + 1 };
    },
  });
  await runWithTenant({ id: 77, slug: "surrounding" }, async () => {
    await expect(
      app.run(async (scope) => {
        const tenant = await authenticate(
          new Request("http://example.test/scim/Users", {
            headers: { authorization: "Bearer fixture-token" },
          }),
          scope.resolve(DATABASE_SESSION_TOKEN),
        );
        if (tenant instanceof Response)
          throw new Error("Unexpected fixture authentication rejection");
        return runWithTenant(tenant, () => {
          consumers++;
          return new Response("unexpected");
        });
      }),
    ).rejects.toThrow("different identity");
    expect(currentTenantId()).toBe(77);
  });
  expect(lookedUp).toEqual([1]);
  expect(queries).toBe(1);
  expect(consumers).toBe(0);
  expect(() => currentTenantId()).toThrow("Tenant context is required");
});
