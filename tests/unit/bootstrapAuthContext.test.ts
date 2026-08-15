import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AuthUser, createAuthMiddleware, currentAuthUser } from "@getstrata/core";
import { CORE_AUTH_TOKEN } from "../../src/bootstrap/config";
import { type AppDependencies, ServiceContainer } from "../../src/bootstrap/contracts";
import { createHttpKernel } from "../../src/bootstrap/httpKernel";

function createDependencies(authUser: AuthUser | null): AppDependencies {
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, {
    resolve: async () => authUser,
  });

  return {
    container,
    cache: {
      remember: async (_key, callback) => callback(),
      tags: () => ({
        remember: async (_key, callback) => callback(),
        flush: async () => 0,
      }),
    },
  } as AppDependencies;
}

describe("bootstrap auth context", () => {
  test("wrapWebGlobalAdmin reads the same async auth store as createAuthMiddleware", async () => {
    const admin: AuthUser = { id: 1, role: "admin", abilities: ["*"] };
    const dependencies = createDependencies(admin);
    const kernel = createHttpKernel(dependencies);
    const auth = dependencies.container.resolve<{ resolve: () => Promise<AuthUser | null> }>(
      CORE_AUTH_TOKEN,
    );

    const handler = kernel.wrapWebGlobalAdmin(async () => {
      expect(currentAuthUser()?.role).toBe("admin");
      return new Response("ok");
    });

    const request = new Request("http://example.test/admin");
    const response = await createAuthMiddleware(auth as never)(request, async () =>
      handler(request),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("published bootstrap bundle does not define duplicate global-admin middleware", () => {
    const bundlePath = join(process.cwd(), "packages/strata-bootstrap/dist/index.js");
    const bundle = readFileSync(bundlePath, "utf8");

    expect(bundle.includes("function createRequireGlobalAdminMiddleware")).toBe(false);
    expect(bundle.includes("function createAuthMiddleware")).toBe(false);
  });
});
