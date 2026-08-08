import { describe, expect, test } from "bun:test";
import { Policy, PolicyGate } from "../../src/core/auth/policy";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { createAuthorizeMiddleware } from "../../src/core/http/authorizeMiddleware";
import { composeMiddleware } from "../../src/core/http/middleware";
import { createRouteMiddleware } from "../../src/bootstrap/routeMiddleware";
import { applyRouteMiddleware, parseRouteMiddlewareName } from "../../src/core/http/routeMiddlewareGroups";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "../../src/bootstrap/config";
import type { RouteHandler } from "../../src/core/http/middleware";
import type { AppDependencies } from "../../src/bootstrap/contracts";

class ProjectPolicy extends Policy {
  override delete(user: { role?: string } | null): boolean {
    return user?.role === "member";
  }
}

describe("createAuthorizeMiddleware", () => {
  test("returns 403 when the policy rejects the action", async () => {
    const gate = new PolicyGate();
    const auth = new AuthManager(new GuestGuard());
    gate.register("project", new ProjectPolicy());
    const handler = composeMiddleware(
      createAuthorizeMiddleware(gate, auth, "project", "delete"),
    )(async () => Response.json({ ok: true }));

    const response = await handler(new Request("http://example.test/projects/1"));

    expect(response.status).toBe(403);
  });

  test("allows authorized users through", async () => {
    const gate = new PolicyGate();
    const auth = new AuthManager(new GuestGuard());
    gate.register("project", new ProjectPolicy());
    const handler = composeMiddleware(
      createAuthorizeMiddleware(gate, auth, "project", "delete"),
    )(async () => Response.json({ ok: true }));

    const response = await handler(
      new Request("http://example.test/projects/1", {
        headers: {
          "x-authenticated-user-id": "1",
          "x-authenticated-user-role": "member",
        },
      }),
    );

    expect(response.status).toBe(200);
  });
});

describe("route middleware groups", () => {
  test("parses auth and can middleware names", () => {
    const container = new ServiceContainer();
    container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
    container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());

    const middleware = createRouteMiddleware({
      container,
      cache: {} as AppDependencies["cache"],
    });

    expect(parseRouteMiddlewareName(middleware, "auth")).toBe(middleware.auth);
    expect(typeof parseRouteMiddlewareName(middleware, "can:delete,project")).toBe(
      "function",
    );
  });

  test("applies middleware groups to route handlers", async () => {
    const gate = new PolicyGate();
    gate.register("project", new ProjectPolicy());
    const container = new ServiceContainer();
    container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
    container.set(CORE_POLICY_GATE_TOKEN, gate);
    const routeMiddleware = createRouteMiddleware({
      container,
      cache: {} as AppDependencies["cache"],
    });

    const handler = applyRouteMiddleware(
      routeMiddleware,
      ["auth", "can:delete,project"],
      (async () => Response.json({ ok: true })) as RouteHandler,
    );

    const response = await handler(
      new Request("http://example.test/projects/1", {
        method: "DELETE",
        headers: {
          "x-authenticated-user-id": "2",
          "x-authenticated-user-role": "member",
        },
      }),
    );

    expect(response.status).toBe(200);
  });
});
