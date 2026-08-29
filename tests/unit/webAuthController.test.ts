import { describe, expect, mock, test } from "bun:test";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { organizationServiceToken } from "../../src/modules/organization/provider";
import {
  authServiceToken,
  passwordResetServiceToken,
  tokenServiceToken,
} from "../../src/modules/user/provider";
import WebAuthController from "../../src/modules/user/webAuthController";
import { createMockCache, createMockDependencies } from "./testHelpers";

function createController(services: {
  authService?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  passwordResets?: Record<string, unknown>;
  organizations?: Record<string, unknown>;
  view?: Record<string, unknown>;
}): WebAuthController {
  const container = new ServiceContainer();
  container.set(authServiceToken, {
    authenticatePassword: mock(async () => ({ id: 1, email: "admin@workhub.test", role: "admin" })),
    loginWithPassword: mock(async () => ({ plainTextToken: "session-token" })),
    listOAuthProviders: mock(() => []),
    authenticateOAuth: mock(async () => ({ id: 4, email: "oauth@workhub.test", role: "member" })),
    registerWithPassword: mock(async () => ({
      id: 9,
      name: "Ada",
      email: "new@workhub.test",
      role: "member",
    })),
    buildOAuthAuthorizationUrl: mock(
      (_name: string, state: string, redirectUri?: string) =>
        `https://mock.oauth/authorize?state=${state}${redirectUri ? `&redirect_uri=${encodeURIComponent(redirectUri)}` : ""}`,
    ),
    ...services.authService,
  });
  container.set(passwordResetServiceToken, {
    sendEmailVerification: mock(async () => undefined),
    ...services.passwordResets,
  });
  container.set(tokenServiceToken, {
    resolveUserFromToken: mock(async () => ({ id: 1, role: "member" })),
    ...services.tokens,
  });
  container.set(organizationServiceToken, {
    createPersonalForUser: mock(async () => ({
      id: 42,
      name: "Ada's workspace",
      slug: "personal-9",
    })),
    ...services.organizations,
  });
  container.set(CORE_VIEW_TOKEN, {
    render: mock(async (_template: string, context: Record<string, unknown>) =>
      JSON.stringify(context),
    ),
    ...services.view,
  });

  return new WebAuthController(createMockDependencies(container, createMockCache()));
}

describe("WebAuthController", () => {
  test("showLogin renders the login page with redirect query params", async () => {
    const controller = createController({});

    const response = await controller.showLogin(
      new Request("http://example.test/login?redirect=%2Fprojects%2F1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");

    const body = JSON.parse(await response.text()) as {
      redirect: string;
      title: string;
      providers: unknown[];
    };
    expect(body.redirect).toBe("/projects/1");
    expect(body.title).toBe("Sign in");
    expect(body.providers).toEqual([]);
  });

  test("showLogin defaults redirect when request is omitted", async () => {
    const controller = createController({});

    const response = await controller.showLogin();

    const body = JSON.parse(await response.text()) as { redirect: string };
    expect(body.redirect).toBe("/organizations");
  });

  test("login redirects to safe relative paths with a session cookie", async () => {
    const controller = createController({});

    const response = await controller.login(
      new Request("http://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=admin%40workhub.test&password=password123&redirect=%2Fprojects",
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/projects");
    expect(response.headers.get("Set-Cookie")).toContain("workhub_session=");
  });

  test("login falls back to organizations for unsafe redirects", async () => {
    const controller = createController({});

    const response = await controller.login(
      new Request("http://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=admin%40workhub.test&password=password123&redirect=https%3A%2F%2Fevil.test",
      }),
    );

    expect(response.headers.get("Location")).toBe("/organizations");
  });

  test("login re-renders invalid credentials without creating a session", async () => {
    const { UnauthorizedError } = await import("@getstrata/core/errors/http");
    const controller = createController({
      authService: {
        authenticatePassword: mock(async () => {
          throw new UnauthorizedError("Invalid credentials.");
        }),
      },
    });

    const response = await controller.login(
      new Request("http://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=admin%40workhub.test&password=password123",
      }),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.text()).toContain("Invalid credentials.");
  });

  test("showLogin includes registered OAuth providers", async () => {
    const controller = createController({
      authService: {
        listOAuthProviders: mock(() => [{ name: "mock", label: "Mock provider" }]),
      },
    });

    const body = JSON.parse(await (await controller.showLogin()).text()) as {
      providers: Array<{ name: string; label: string }>;
    };

    expect(body.providers).toEqual([{ name: "mock", label: "Mock provider" }]);
  });

  test("oauthRedirect sets state cookie and sends the web callback uri", async () => {
    const controller = createController({});
    const response = await controller.oauthRedirect(
      Object.assign(new Request("http://example.test/oauth/mock?redirect=%2Fprojects"), {
        params: { provider: "mock" },
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("state=");
    expect(response.headers.get("Location")).toContain(
      encodeURIComponent("http://example.test/oauth/mock/callback"),
    );
    expect(response.headers.get("Set-Cookie")).toContain("oauth_state=");
    expect(response.headers.get("Set-Cookie")).toContain("oauth_login_redirect=");
  });

  test("oauthRedirect re-renders login for an unknown provider", async () => {
    const { UnauthorizedError } = await import("@getstrata/core/errors/http");
    const controller = createController({
      authService: {
        buildOAuthAuthorizationUrl: mock(() => {
          throw new UnauthorizedError("Unsupported OAuth provider.");
        }),
      },
    });

    const response = await controller.oauthRedirect(
      Object.assign(new Request("http://example.test/oauth/missing"), {
        params: { provider: "missing" },
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Unsupported OAuth provider.");
  });

  test("oauthCallback sets a session cookie without issuing an API token", async () => {
    const { createOAuthStateCookie } = await import("@getstrata/core/security/oauthState");
    const { state, cookie } = createOAuthStateCookie();
    const authenticateOAuth = mock(async () => ({
      id: 4,
      email: "oauth@workhub.test",
      role: "member",
    }));
    const controller = createController({
      authService: { authenticateOAuth },
    });

    const response = await controller.oauthCallback(
      Object.assign(
        new Request(`http://example.test/oauth/mock/callback?code=valid-code&state=${state}`, {
          headers: { cookie: `${cookie}; oauth_login_redirect=${encodeURIComponent("/projects")}` },
        }),
        { params: { provider: "mock" } },
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/projects");
    expect(response.headers.get("Set-Cookie")).toContain("workhub_session=");
    expect(authenticateOAuth).toHaveBeenCalledWith("mock", "valid-code", {
      redirectUri: "http://example.test/oauth/mock/callback",
    });
  });

  test("oauthCallback rejects invalid state", async () => {
    const controller = createController({});
    const response = await controller.oauthCallback(
      Object.assign(
        new Request("http://example.test/oauth/mock/callback?code=valid-code&state=nope"),
        { params: { provider: "mock" } },
      ),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.text()).toContain("Invalid OAuth state.");
  });

  test("showRegister renders the registration page", async () => {
    const controller = createController({});
    const response = await controller.showRegister();
    const body = JSON.parse(await response.text()) as { title: string };

    expect(response.status).toBe(200);
    expect(body.title).toBe("Create account");
  });

  test("register sets a session cookie when email verification is off", async () => {
    const controller = createController({});
    const response = await controller.register(
      new Request("http://example.test/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "name=Ada&email=new%40workhub.test&password=password123&password_confirmation=password123",
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/organizations/42");
    expect(response.headers.get("Set-Cookie")).toContain("workhub_session=");
  });

  test("register redirects to login when email verification is required", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    const sendEmailVerification = mock(async () => undefined);

    try {
      const controller = createController({
        passwordResets: { sendEmailVerification },
      });
      const response = await controller.register(
        new Request("http://example.test/register", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "name=Ada&email=new%40workhub.test&password=password123&password_confirmation=password123",
        }),
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
      expect(response.headers.get("Set-Cookie")).not.toContain("workhub_session=");
      expect(sendEmailVerification).toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.FEATURE_EMAIL_VERIFICATION;
      } else {
        process.env.FEATURE_EMAIL_VERIFICATION = previous;
      }
    }
  });

  test("register re-renders duplicate email errors", async () => {
    const { ValidationError } = await import("@getstrata/core/errors/http");
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
      new Request("http://example.test/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "name=Ada&email=admin%40workhub.test&password=password123&password_confirmation=password123",
      }),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.text()).toContain("already exists");
  });

  test("registerThrottled returns a 429 register form", async () => {
    const controller = createController({});
    const response = await controller.registerThrottled();

    expect(response.status).toBe(429);
    expect(await response.text()).toContain("Too many registration attempts");
  });

  test("loginThrottled returns a 429 login form", async () => {
    const controller = createController({});
    const response = await controller.loginThrottled();

    expect(response.status).toBe(429);
    expect(await response.text()).toContain("Too many login attempts");
  });

  test("forgotPasswordThrottled returns a 429 reset form", async () => {
    const controller = createController({});
    const response = await controller.forgotPasswordThrottled();

    expect(response.status).toBe(429);
    expect(await response.text()).toContain("Too many reset attempts");
  });

  test("logout clears the session cookie and redirects to login", async () => {
    const controller = createController({});

    const response = await controller.logout();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("workhub_session=");
  });
});
