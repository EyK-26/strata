import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createOAuthStateCookie } from "@getstrata/core/security/oauthState";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import {
  authServiceToken,
  notificationServiceToken,
  tokenServiceToken,
} from "../../src/modules/user/provider";
import type { UserRecord } from "../../src/modules/user/types";
import { createMockCache, createMockDependencies, defaultTestTenant } from "./testHelpers";

type AuthControllerClass = typeof import("../../src/modules/user/controller").default;
type AuthControllerInstance = InstanceType<AuthControllerClass>;

let AuthControllerClass: AuthControllerClass;

const now = new Date("2026-01-01T00:00:00.000Z");

const user: UserRecord = {
  id: 1,
  name: "Admin User",
  email: "admin@workhub.test",
  role: "admin",
  tenant_id: 1,
  created_at: now,
  updated_at: now,
};

function createController(services: {
  auth?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  authService?: Record<string, unknown>;
}): AuthControllerInstance {
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, {
    requireUser: mock(async () => ({ id: 1, role: "admin" })),
    ...services.auth,
  });
  container.set(tokenServiceToken, {
    resolveUserFromToken: mock(async () => ({ id: 1, role: "admin" })),
    findByIdOrThrow: mock(async () => user),
    listTokensForUser: mock(async () => []),
    createToken: mock(async () => ({
      plainTextToken: "plain-token",
      token: { id: 9, name: "ci", abilities: ["*"] },
    })),
    revokeToken: mock(async () => undefined),
    deleteUserAccount: mock(async () => undefined),
    ...services.tokens,
  });
  container.set(authServiceToken, {
    loginWithPassword: mock(async () => ({ plainTextToken: "plain-token" })),
    buildOAuthAuthorizationUrl: mock(() => "https://oauth.example/authorize"),
    loginWithOAuth: mock(async () => ({ plainTextToken: "oauth-token" })),
    ...services.authService,
  });
  container.set(notificationServiceToken, {
    listForUser: mock(async () => ({
      data: [],
      meta: { page: 1, per_page: 20, total: 0, last_page: 1 },
    })),
    markRead: mock(async () => ({
      id: 1,
      type: "task.assigned",
      title: "Assigned",
      body: "You were assigned",
      data: {},
      read_at: new Date(),
      created_at: now,
      user_id: 1,
      tenant_id: 1,
    })),
    markAllRead: mock(async () => 0),
  });

  return new AuthControllerClass(createMockDependencies(container, createMockCache()));
}

beforeAll(async () => {
  ({ default: AuthControllerClass } = await import("../../src/modules/user/controller"));
});

describe("AuthController", () => {
  test("login returns token and user resource", async () => {
    const controller = createController({});

    const response = await controller.login(
      new Request("http://example.test/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin@workhub.test",
          password: "password123",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      token: "plain-token",
      user: {
        id: 1,
        name: "Admin User",
        email: "admin@workhub.test",
        role: "admin",
      },
    });
  });

  test("login rejects unresolved authenticated users", async () => {
    const controller = createController({
      tokens: { resolveUserFromToken: mock(async () => null) },
    });

    const response = await controller.login(
      new Request("http://example.test/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin@workhub.test",
          password: "password123",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unable to resolve authenticated user." });
  });

  test("oauthRedirect redirects to the provider authorization url", async () => {
    const controller = createController({});

    const response = await controller.oauthRedirect({
      params: { provider: "mock" },
    } as Request & { params: { provider: string } });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://oauth.example/authorize");
    expect(response.headers.get("Set-Cookie")).toContain("oauth_state=");
  });

  test("oauthRedirect requires a provider", async () => {
    const controller = createController({});

    const response = await controller.oauthRedirect({
      params: {},
    } as Request & { params: Record<string, never> });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "OAuth provider is required." });
  });

  test("oauthCallback exchanges codes for tokens and clears state cookies", async () => {
    const { state, cookie } = createOAuthStateCookie();
    const controller = createController({});

    const response = await controller.oauthCallback(
      Object.assign(
        new Request(`http://example.test/auth/mock/callback?code=abc&state=${state}`, {
          headers: { cookie },
        }),
        { params: { provider: "mock" } },
      ),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      token: "oauth-token",
      user: {
        id: 1,
        name: "Admin User",
        email: "admin@workhub.test",
        role: "admin",
      },
    });
    expect(response.headers.get("Set-Cookie")).toContain("oauth_state=");
  });

  test("oauthCallback validates provider, code, and state", async () => {
    const controller = createController({});

    const missingCodeResponse = await controller.oauthCallback(
      Object.assign(new Request("http://example.test/auth/mock/callback"), {
        params: { provider: "mock" },
      }),
    );

    expect(missingCodeResponse.status).toBe(400);
    expect(await missingCodeResponse.json()).toEqual({
      error: "OAuth provider and code are required.",
    });

    const { state } = createOAuthStateCookie();
    const invalidStateResponse = await controller.oauthCallback(
      Object.assign(new Request(`http://example.test/auth/mock/callback?code=abc&state=${state}`), {
        params: { provider: "mock" },
      }),
    );

    expect(invalidStateResponse.status).toBe(401);
    expect(await invalidStateResponse.json()).toEqual({ error: "Invalid OAuth state." });
  });

  test("oauthCallback rejects unresolved authenticated users", async () => {
    const { state, cookie } = createOAuthStateCookie();
    const controller = createController({
      tokens: { resolveUserFromToken: mock(async () => null) },
    });

    const response = await controller.oauthCallback(
      Object.assign(
        new Request(`http://example.test/auth/mock/callback?code=abc&state=${state}`, {
          headers: { cookie },
        }),
        { params: { provider: "mock" } },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unable to resolve authenticated user." });
  });

  test("me returns the authenticated user resource", async () => {
    const controller = createController({});

    const response = await controller.me(new Request("http://example.test/auth/me"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 1,
      name: "Admin User",
      email: "admin@workhub.test",
      role: "admin",
    });
  });

  test("me rejects invalid authenticated user ids", async () => {
    const controller = createController({
      auth: { requireUser: mock(async () => ({ id: "invalid", role: "admin" })) },
    });

    const response = await controller.me(new Request("http://example.test/auth/me"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  test("exportMe returns user, token, and oauth identity exports", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const UserRepository = (await import("../../src/modules/user/repository")).default;
      const users = new UserRepository();
      const admin = await users.findByEmail("admin@workhub.test");
      expect(admin).not.toBeNull();
      if (!admin) {
        return;
      }

      const controller = createController({
        auth: { requireUser: mock(async () => ({ id: admin.id, role: "admin" })) },
        tokens: { findByIdOrThrow: mock(async () => admin) },
      });

      const response = await controller.exportMe(new Request("http://example.test/auth/export"));

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        user: { id: number };
        api_tokens: Array<{ id: number; name: string }>;
        oauth_identities: Array<{ provider: string }>;
        exported_at: string;
      };

      expect(body.user.id).toBe(admin.id);
      expect(Array.isArray(body.api_tokens)).toBe(true);
      expect(Array.isArray(body.oauth_identities)).toBe(true);
      expect(body.exported_at).toBeTruthy();
    });
  });

  test("exportMe includes oauth identity exports when present", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const UserRepository = (await import("../../src/modules/user/repository")).default;
      const OAuthIdentityRepository = (
        await import("../../src/modules/user/oauthIdentityRepository")
      ).default;
      const users = new UserRepository();
      const admin = await users.findByEmail("admin@workhub.test");
      expect(admin).not.toBeNull();
      if (!admin) {
        return;
      }

      const oauthRepo = new OAuthIdentityRepository();
      await oauthRepo.create({
        user_id: admin.id,
        provider: `mock-${Date.now()}`,
        provider_user_id: `oauth-admin-${Date.now()}`,
        email: admin.email,
        created_at: new Date(),
      });

      const controller = createController({
        auth: { requireUser: mock(async () => ({ id: admin.id, role: "admin" })) },
        tokens: { findByIdOrThrow: mock(async () => admin) },
      });

      const response = await controller.exportMe(new Request("http://example.test/auth/export"));
      const body = (await response.json()) as {
        oauth_identities: Array<{ provider: string; email: string; created_at: string }>;
      };

      expect(body.oauth_identities.some((identity) => identity.email === admin.email)).toBe(true);
      expect(body.oauth_identities[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  test("deleteMe removes the authenticated user account", async () => {
    const deleteUserAccount = mock(async () => undefined);
    const controller = createController({
      tokens: { deleteUserAccount },
    });

    const response = await controller.deleteMe(new Request("http://example.test/auth/me"));

    expect(response.status).toBe(204);
    expect(deleteUserAccount).toHaveBeenCalledWith(1);
  });

  test("listTokens returns tokens for the authenticated user", async () => {
    const listTokensForUser = mock(async () => [{ id: 4, name: "mobile" }]);
    const controller = createController({
      tokens: { listTokensForUser },
    });

    const response = await controller.listTokens(new Request("http://example.test/auth/tokens"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: 4, name: "mobile" }] });
  });

  test("storeToken creates a token from the request body", async () => {
    const createToken = mock(async () => ({
      plainTextToken: "created-token",
      token: { id: 11, name: "automation", abilities: ["tasks:read"] },
    }));
    const controller = createController({
      tokens: { createToken },
    });

    const response = await controller.storeToken(
      new Request("http://example.test/auth/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "automation",
          abilities: ["tasks:read"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      token: "created-token",
      id: 11,
      name: "automation",
      abilities: ["tasks:read"],
    });
  });

  test("destroyToken revokes a token for the authenticated user", async () => {
    const revokeToken = mock(async () => undefined);
    const controller = createController({
      tokens: { revokeToken },
    });

    const response = await controller.destroyToken(
      Object.assign(new Request("http://example.test/auth/tokens/5"), {
        params: { id: "5" },
      }),
    );

    expect(response.status).toBe(204);
    expect(revokeToken).toHaveBeenCalledWith(1, 5);
  });

  test("destroyToken requires a token id", async () => {
    const controller = createController({});

    const response = await controller.destroyToken(
      Object.assign(new Request("http://example.test/auth/tokens/"), {
        params: {},
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Token id is required." });
  });
});

afterAll(() => {
  mock.restore();
});
