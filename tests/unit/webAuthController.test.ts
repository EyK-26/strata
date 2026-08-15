import { describe, expect, mock, test } from "bun:test";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import { CORE_VIEW_TOKEN } from "../../src/bootstrap/providers/view";
import { authServiceToken, tokenServiceToken } from "../../src/modules/user/provider";
import WebAuthController from "../../src/modules/user/webAuthController";
import { createMockCache, createMockDependencies } from "./testHelpers";

function createController(services: {
  authService?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  view?: Record<string, unknown>;
}): WebAuthController {
  const container = new ServiceContainer();
  container.set(authServiceToken, {
    loginWithPassword: mock(async () => ({ plainTextToken: "session-token" })),
    ...services.authService,
  });
  container.set(tokenServiceToken, {
    resolveUserFromToken: mock(async () => ({ id: 1, role: "member" })),
    ...services.tokens,
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

    const body = JSON.parse(await response.text()) as { redirect: string; title: string };
    expect(body.redirect).toBe("/projects/1");
    expect(body.title).toBe("Sign in");
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

  test("login rejects unresolved authenticated users", async () => {
    const controller = createController({
      tokens: { resolveUserFromToken: mock(async () => null) },
    });

    const response = await controller.login(
      new Request("http://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=admin%40workhub.test&password=password123",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unable to resolve authenticated user." });
  });

  test("logout clears the session cookie and redirects to login", async () => {
    const controller = createController({});

    const response = await controller.logout();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("workhub_session=");
  });
});
