import { describe, expect, mock, test } from "bun:test";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { hashPassword } from "@getstrata/core/auth/password";
import {
  authServiceToken,
  oauthIdentityRepositoryToken,
  passwordResetServiceToken,
  tokenServiceToken,
  userRepositoryToken,
} from "../../src/modules/user/provider";
import type { ApiTokenResource, UserRecord } from "../../src/modules/user/types";
import WebAccountController from "../../src/modules/user/webAccountController";
import { createMockCache, createMockDependencies } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

const adminUser: UserRecord = {
  id: 1,
  name: "Admin User",
  email: "admin@workhub.test",
  role: "admin",
  tenant_id: 1,
  password_hash: "hashed",
  email_verified_at: now,
  created_at: now,
  updated_at: now,
};

const sampleToken: ApiTokenResource = {
  id: 9,
  name: "ci",
  abilities: ["*"],
  last_used_at: null,
  expires_at: null,
  created_at: now.toISOString(),
};

function createController(services: {
  users?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  oauth?: Record<string, unknown>;
  view?: Record<string, unknown>;
}): WebAccountController {
  const container = new ServiceContainer();
  container.set(userRepositoryToken, {
    findByIdOrThrow: mock(async () => adminUser),
    ...services.users,
  });
  container.set(tokenServiceToken, {
    listTokensForUser: mock(async () => [sampleToken]),
    createToken: mock(async () => ({
      token: sampleToken,
      plainTextToken: "plain-token-once",
    })),
    revokeToken: mock(async () => undefined),
    deleteUserAccount: mock(async () => undefined),
    ...services.tokens,
  });
  container.set(oauthIdentityRepositoryToken, {
    findAll: mock(async () => []),
    ...services.oauth,
  });
  container.set(authServiceToken, {});
  container.set(passwordResetServiceToken, {
    sendEmailVerification: mock(async () => undefined),
  });
  container.set(CORE_VIEW_TOKEN, {
    render: mock(async (_template: string, context: Record<string, unknown>) =>
      JSON.stringify(context),
    ),
    ...services.view,
  });

  return new WebAccountController(createMockDependencies(container, createMockCache()));
}

function asAuthed<T>(callback: () => T | Promise<T>, user = { id: 1, role: "admin" }): Promise<T> {
  return runWithAuthUser(user, callback) as Promise<T>;
}

describe("WebAccountController", () => {
  test("show includes the token list", async () => {
    const controller = createController({});
    const response = await asAuthed(() => controller.show());
    const body = JSON.parse(await response.text()) as { tokens: ApiTokenResource[] };

    expect(response.status).toBe(200);
    expect(body.tokens).toEqual([sampleToken]);
  });

  test("storeToken renders the one-time plaintext token", async () => {
    const controller = createController({});
    const response = await asAuthed(() =>
      controller.storeToken(
        new Request("http://example.test/account/tokens", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "name=ci&expires_in_days=30",
        }),
      ),
    );
    const body = JSON.parse(await response.text()) as { plainToken: string };

    expect(response.status).toBe(200);
    expect(body.plainToken).toBe("plain-token-once");
  });

  test("storeToken re-renders validation errors", async () => {
    const controller = createController({});
    const response = await asAuthed(() =>
      controller.storeToken(
        new Request("http://example.test/account/tokens", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "name=",
        }),
      ),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("name");
  });

  test("revokeToken redirects after destroying the row", async () => {
    const revokeToken = mock(async () => undefined);
    const controller = createController({ tokens: { revokeToken } });
    const request = new Request("http://example.test/account/tokens/9/revoke", {
      method: "POST",
    }) as Request & { params?: { id: string } };
    request.params = { id: "9" };

    const response = await asAuthed(() => controller.revokeToken(request));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/account");
    expect(revokeToken).toHaveBeenCalledWith(1, 9);
  });

  test("revokeToken requires a token id", async () => {
    const controller = createController({});
    const response = await asAuthed(() =>
      controller.revokeToken(new Request("http://example.test/account/tokens/revoke")),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("exportAccount returns a JSON attachment", async () => {
    const controller = createController({
      oauth: {
        findAll: mock(async () => [
          {
            provider: "github",
            email: "admin@workhub.test",
            created_at: now,
          },
        ]),
      },
    });
    const response = await asAuthed(() => controller.exportAccount());
    const payload = (await response.json()) as {
      user: { email: string };
      api_tokens: Array<{ name: string }>;
      oauth_identities: Array<{ provider: string }>;
    };

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toContain("workhub-export.json");
    expect(payload.user.email).toBe("admin@workhub.test");
    expect(payload.api_tokens[0]?.name).toBe("ci");
    expect(payload.oauth_identities[0]?.provider).toBe("github");
  });

  test("deleteAccount rejects a wrong password", async () => {
    const passwordHash = await hashPassword("correct-horse");
    const controller = createController({
      users: {
        findByIdOrThrow: mock(async () => ({ ...adminUser, password_hash: passwordHash })),
      },
    });
    const response = await asAuthed(() =>
      controller.deleteAccount(
        new Request("http://example.test/account/delete", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "password=wrong&confirm=DELETE",
        }),
      ),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Invalid credentials.");
  });

  test("deleteAccount clears the session cookie", async () => {
    const passwordHash = await hashPassword("correct-horse");
    const deleteUserAccount = mock(async () => undefined);
    const controller = createController({
      users: {
        findByIdOrThrow: mock(async () => ({ ...adminUser, password_hash: passwordHash })),
      },
      tokens: { deleteUserAccount },
    });
    const response = await asAuthed(() =>
      controller.deleteAccount(
        new Request("http://example.test/account/delete", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "password=correct-horse&confirm=DELETE",
        }),
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("set-cookie")).toContain("workhub_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(deleteUserAccount).toHaveBeenCalledWith(1);
  });

  test("deleteAccount requires typing DELETE", async () => {
    const controller = createController({});
    const response = await asAuthed(() =>
      controller.deleteAccount(
        new Request("http://example.test/account/delete", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "password=password&confirm=please",
        }),
      ),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Type DELETE to confirm.");
  });

  test("requireUserId rejects a missing session", async () => {
    const controller = createController({});
    const response = await runWithAuthUser(null, () => controller.show());

    expect(response.status).toBe(401);
  });
});
