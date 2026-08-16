import { describe, expect, test } from "bun:test";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { Policy, PolicyGate } from "../../src/core/auth/policy";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { createAuthorizeMiddleware } from "../../src/core/http/authorizeMiddleware";
import { composeMiddleware } from "../../src/core/http/middleware";

class ProjectPolicy extends Policy {
  override delete(user: { role?: string } | null): boolean {
    return user?.role === "member";
  }
}

import { createMockDependencies } from "./testHelpers";

function createKernelDependencies(): AppDependencies {
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());

  return createMockDependencies(
    container,
    new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
  );
}

describe("createAuthorizeMiddleware", () => {
  test("returns 403 when the policy rejects the action", async () => {
    const gate = new PolicyGate();
    const auth = new AuthManager(new GuestGuard());
    gate.register("project", new ProjectPolicy());
    const handler = composeMiddleware(createAuthorizeMiddleware(gate, auth, "project", "delete"))(
      async () => Response.json({ ok: true }),
    );

    const response = await handler(new Request("http://example.test/projects/1"));

    expect(response.status).toBe(403);
  });

  test("allows authorized users through", async () => {
    const gate = new PolicyGate();
    const auth = new AuthManager(new GuestGuard());
    gate.register("project", new ProjectPolicy());
    const handler = composeMiddleware(createAuthorizeMiddleware(gate, auth, "project", "delete"))(
      async () => Response.json({ ok: true }),
    );

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

describe("HttpKernel.wrapPolicy", () => {
  test("applies auth and policy middleware to route handlers", async () => {
    const dependencies = createKernelDependencies();
    const gate = dependencies.container.resolve<PolicyGate>(CORE_POLICY_GATE_TOKEN);
    gate.register("project", new ProjectPolicy());

    const kernel = createHttpKernel(dependencies);
    const handler = kernel.wrapPolicy("project", "delete", async () => Response.json({ ok: true }));

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
