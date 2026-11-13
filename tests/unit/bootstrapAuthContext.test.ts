import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { type AppDependencies, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { type AuthUser, createAuthMiddleware, currentAuthUser } from "@getstrata/core";
import { establishedAuthReader } from "@getstrata/core/auth/authReader";
import { createMockDependencies } from "./testHelpers";

function createDependencies(authUser: AuthUser | null): AppDependencies {
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, {
    ...establishedAuthReader,
    resolveWithSource: async () => ({ user: authUser, credentialSource: null }),
    resolve: async () => authUser,
  });

  return createMockDependencies(container);
}

describe("bootstrap auth context", () => {
  test("wrapWebGlobalAdmin reads the same async auth store as createAuthMiddleware", async () => {
    const admin: AuthUser = { id: 1, role: "admin", abilities: ["*"] };
    const dependencies = createDependencies(admin);
    const kernel = createHttpKernel(dependencies);
    const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);

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
