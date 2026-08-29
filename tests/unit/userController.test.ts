import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { ValidationError } from "@getstrata/core/errors/http";
import { createOAuthStateCookie } from "@getstrata/core/security/oauthState";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { organizationServiceToken } from "../../src/modules/organization/provider";
import {
  createMfaChallenge,
  createMfaChallengeCookie,
} from "../../src/modules/user/mfaChallengeCookie";
import { MfaRequiredError } from "../../src/modules/user/mfaRequiredError";
import {
  authServiceToken,
  notificationServiceToken,
  passwordResetServiceToken,
  tokenServiceToken,
} from "../../src/modules/user/provider";
import type { UserRecord } from "../../src/modules/user/types";
import { restoreEnvVar } from "../helpers/restoreEnv";
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
  passwordResets?: Record<string, unknown>;
  organizations?: Record<string, unknown>;
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
    registerWithPassword: mock(async () => ({
      id: 9,
      name: "Ada Lovelace",
      email: "ada@workhub.test",
      role: "member",
    })),
    buildOAuthAuthorizationUrl: mock(() => "https://oauth.example/authorize"),
    loginWithOAuth: mock(async () => ({ plainTextToken: "oauth-token" })),
    ...services.authService,
  });
  container.set(passwordResetServiceToken, {
    sendEmailVerification: mock(async () => undefined),
    requestEmailVerification: mock(async () => undefined),
    requestReset: mock(async () => undefined),
    resetPassword: mock(async () => undefined),
    ...services.passwordResets,
  });
  container.set(organizationServiceToken, {
    createPersonalForUser: mock(async () => ({
      id: 42,
      name: "Ada Lovelace's workspace",
      slug: "personal-9",
    })),
    ...services.organizations,
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

  test("login returns a two-factor challenge when MFA is required", async () => {
    const controller = createController({
      authService: {
        loginWithPassword: mock(async () => {
          throw new MfaRequiredError(1);
        }),
      },
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

    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      error: string;
      two_factor: boolean;
      mfa_pending: string;
    };
    expect(body).toMatchObject({
      error: "Two-factor authentication required.",
      two_factor: true,
    });
    expect(body.mfa_pending).toContain(".");
    expect(response.headers.get("set-cookie")).toContain("workhub_mfa_pending=");
  });

  test("twoFactorChallenge completes login from mfa_pending", async () => {
    const loginWithMfaChallenge = mock(async () => ({ plainTextToken: "challenge-token" }));
    const controller = createController({
      authService: { loginWithMfaChallenge },
    });
    const challenge = createMfaChallenge(1);

    const response = await controller.twoFactorChallenge(
      new Request("http://example.test/auth/two-factor-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "123456",
          mfa_pending: challenge.value,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      token: "challenge-token",
      user: {
        id: 1,
        name: "Admin User",
        email: "admin@workhub.test",
        role: "admin",
      },
    });
    expect(loginWithMfaChallenge).toHaveBeenCalledWith(1, "123456");
    expect(response.headers.get("set-cookie")).toContain("workhub_mfa_pending=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("twoFactorChallenge accepts the pending cookie", async () => {
    const loginWithMfaChallenge = mock(async () => ({ plainTextToken: "cookie-token" }));
    const controller = createController({
      authService: { loginWithMfaChallenge },
    });

    const response = await controller.twoFactorChallenge(
      new Request("http://example.test/auth/two-factor-challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: createMfaChallengeCookie(1),
        },
        body: JSON.stringify({ recovery_code: "abcd-efgh" }),
      }),
    );

    expect(response.status).toBe(201);
    expect((await response.json()) as { token: string }).toEqual({
      token: "cookie-token",
      user: {
        id: 1,
        name: "Admin User",
        email: "admin@workhub.test",
        role: "admin",
      },
    });
    expect(loginWithMfaChallenge).toHaveBeenCalledWith(1, "abcd-efgh");
  });

  test("twoFactorChallenge rejects a missing challenge", async () => {
    const controller = createController({});

    const response = await controller.twoFactorChallenge(
      new Request("http://example.test/auth/two-factor-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mfa_code: "123456" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Two-factor authentication required." });
  });

  test("twoFactorChallenge rejects unresolved authenticated users", async () => {
    const controller = createController({
      tokens: { resolveUserFromToken: mock(async () => null) },
      authService: {
        loginWithMfaChallenge: mock(async () => ({ plainTextToken: "challenge-token" })),
      },
    });
    const challenge = createMfaChallenge(1);

    const response = await controller.twoFactorChallenge(
      new Request("http://example.test/auth/two-factor-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "123456",
          mfa_pending: challenge.value,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unable to resolve authenticated user." });
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

  test("register returns token and user resource", async () => {
    const createPersonalForUser = mock(async () => ({
      id: 42,
      name: "Ada Lovelace's workspace",
      slug: "personal-9",
    }));
    const controller = createController({
      organizations: { createPersonalForUser },
    });

    const response = await controller.register(
      new Request("http://example.test/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@workhub.test",
          password: "password123",
          password_confirmation: "password123",
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
    expect(createPersonalForUser).toHaveBeenCalledWith({
      id: 9,
      name: "Ada Lovelace",
      email: "ada@workhub.test",
      role: "member",
    });
  });

  test("register returns the user without a token when email verification is required", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    const sendEmailVerification = mock(async () => undefined);
    const createPersonalForUser = mock(async () => ({
      id: 42,
      name: "Ada Lovelace's workspace",
      slug: "personal-9",
    }));

    try {
      const controller = createController({
        passwordResets: { sendEmailVerification },
        organizations: { createPersonalForUser },
      });

      const response = await controller.register(
        new Request("http://example.test/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Ada Lovelace",
            email: "ada@workhub.test",
            password: "password123",
            password_confirmation: "password123",
          }),
        }),
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        user: {
          id: 9,
          name: "Ada Lovelace",
          email: "ada@workhub.test",
          role: "member",
        },
      });
      expect(sendEmailVerification).toHaveBeenCalled();
      expect(createPersonalForUser).toHaveBeenCalled();
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("register rejects duplicate emails", async () => {
    const controller = createController({
      authService: {
        registerWithPassword: mock(async () => {
          throw new ValidationError("An account with this email already exists.", {
            email: ["An account with this email already exists."],
          });
        }),
      },
    });

    const response = await controller.register(
      new Request("http://example.test/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Admin",
          email: "admin@workhub.test",
          password: "password123",
          password_confirmation: "password123",
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "An account with this email already exists.",
      details: { email: ["An account with this email already exists."] },
    });
  });

  test("register rejects unresolved authenticated users", async () => {
    const controller = createController({
      tokens: { resolveUserFromToken: mock(async () => null) },
    });

    const response = await controller.register(
      new Request("http://example.test/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@workhub.test",
          password: "password123",
          password_confirmation: "password123",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unable to resolve authenticated user." });
  });

  test("forgotPassword always returns a generic success message", async () => {
    const requestReset = mock(async () => undefined);
    const controller = createController({
      passwordResets: { requestReset },
    });

    const response = await controller.forgotPassword(
      new Request("http://example.test/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@workhub.test" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "If that email exists, a reset link is on its way.",
    });
    expect(requestReset).toHaveBeenCalledWith("ada@workhub.test");
  });

  test("resendVerification always returns a generic success message", async () => {
    const requestEmailVerification = mock(async () => undefined);
    const controller = createController({
      passwordResets: { requestEmailVerification },
    });

    const response = await controller.resendVerification(
      new Request("http://example.test/auth/email/verification-notification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@workhub.test" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "If that account needs verification, a new link is on its way.",
    });
    expect(requestEmailVerification).toHaveBeenCalledWith("ada@workhub.test");
  });

  test("resetPassword updates the password from the token payload", async () => {
    const resetPassword = mock(async () => undefined);
    const controller = createController({
      passwordResets: { resetPassword },
    });

    const response = await controller.resetPassword(
      new Request("http://example.test/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ada@workhub.test",
          token: "reset-token",
          password: "password123",
          password_confirmation: "password123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Password updated. Sign in with your new password.",
    });
    expect(resetPassword).toHaveBeenCalledWith("ada@workhub.test", "reset-token", "password123");
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
    const createPersonalForUser = mock(async () => ({
      id: 42,
      name: "Admin User's workspace",
      slug: "personal-1",
    }));
    const controller = createController({
      organizations: { createPersonalForUser },
    });

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
    expect(createPersonalForUser).toHaveBeenCalled();
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

  test("updateProfile returns the updated user without sending verification", async () => {
    const sendEmailVerification = mock(async () => undefined);
    const updateProfile = mock(async () => ({
      user: { ...user, name: "Ada Admin" },
      emailChanged: false,
    }));
    const controller = createController({
      authService: { updateProfile },
      passwordResets: { sendEmailVerification },
    });

    const response = await controller.updateProfile(
      new Request("http://example.test/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ada Admin",
          email: "admin@workhub.test",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: {
        id: 1,
        name: "Ada Admin",
        email: "admin@workhub.test",
        role: "admin",
      },
      email_changed: false,
    });
    expect(updateProfile).toHaveBeenCalledWith(1, "Ada Admin", "admin@workhub.test");
    expect(sendEmailVerification).not.toHaveBeenCalled();
  });

  test("updateProfile skips verification mail when the email changes and the flag is off", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "false";
    const sendEmailVerification = mock(async () => undefined);
    const nextUser = { ...user, email: "ada-off@workhub.test" };
    const updateProfile = mock(async () => ({
      user: nextUser,
      emailChanged: true,
    }));

    try {
      const controller = createController({
        authService: { updateProfile },
        passwordResets: { sendEmailVerification },
      });

      const response = await controller.updateProfile(
        new Request("http://example.test/users/me", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Admin User",
            email: "ada-off@workhub.test",
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(((await response.json()) as { email_changed: boolean }).email_changed).toBe(true);
      expect(sendEmailVerification).not.toHaveBeenCalled();
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("updateProfile sends verification when the email changes and the flag is on", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    const sendEmailVerification = mock(async () => undefined);
    const nextUser = {
      ...user,
      email: "ada-admin@workhub.test",
      email_verified_at: null,
    };
    const updateProfile = mock(async () => ({
      user: nextUser,
      emailChanged: true,
    }));

    try {
      const controller = createController({
        authService: { updateProfile },
        passwordResets: { sendEmailVerification },
      });

      const response = await controller.updateProfile(
        new Request("http://example.test/users/me", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Admin User",
            email: "ada-admin@workhub.test",
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        user: {
          id: 1,
          name: "Admin User",
          email: "ada-admin@workhub.test",
          role: "admin",
        },
        email_changed: true,
      });
      expect(sendEmailVerification).toHaveBeenCalledWith(nextUser);
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("beginMfa returns a secret and otpauth url", async () => {
    const beginMfaSetup = mock(async () => ({
      secret: "JBSWY3DPEHPK3PXP",
      otpauthUrl: "otpauth://totp/WorkHub:admin@workhub.test?secret=JBSWY3DPEHPK3PXP",
    }));
    const controller = createController({
      authService: { beginMfaSetup },
    });

    const response = await controller.beginMfa(new Request("http://example.test/users/me/mfa"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      otpauth_url: "otpauth://totp/WorkHub:admin@workhub.test?secret=JBSWY3DPEHPK3PXP",
    });
    expect(beginMfaSetup).toHaveBeenCalledWith(1);
  });

  test("confirmMfa returns recovery codes", async () => {
    const confirmMfaSetup = mock(async () => ({
      user,
      recoveryCodes: ["abcd-efgh"],
    }));
    const controller = createController({
      authService: { confirmMfaSetup },
    });

    const response = await controller.confirmMfa(
      new Request("http://example.test/users/me/mfa/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mfa_code: "123456" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: {
        id: 1,
        name: "Admin User",
        email: "admin@workhub.test",
        role: "admin",
      },
      recovery_codes: ["abcd-efgh"],
    });
    expect(confirmMfaSetup).toHaveBeenCalledWith(1, "123456");
  });

  test("disableMfa returns the updated user", async () => {
    const disableMfa = mock(async () => user);
    const controller = createController({
      authService: { disableMfa },
    });

    const response = await controller.disableMfa(
      new Request("http://example.test/users/me/mfa", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "password" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: {
        id: 1,
        name: "Admin User",
        email: "admin@workhub.test",
        role: "admin",
      },
    });
    expect(disableMfa).toHaveBeenCalledWith(1, "password");
  });

  test("regenerateRecoveryCodes returns a new set", async () => {
    const regenerateRecoveryCodes = mock(async () => ["aaaa-bbbb"]);
    const controller = createController({
      authService: { regenerateRecoveryCodes },
    });

    const response = await controller.regenerateRecoveryCodes(
      new Request("http://example.test/users/me/mfa/recovery-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "password" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recovery_codes: ["aaaa-bbbb"] });
    expect(regenerateRecoveryCodes).toHaveBeenCalledWith(1, "password");
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
