import { afterEach, describe, expect, test } from "bun:test";
import type { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { CORE_TOKEN_SERVICE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  configureWebLayoutData,
  resetWebLayoutDataConfigForTests,
  resolveWebLayoutData,
} from "@getstrata/core/view/webLayoutData";

describe("resolveWebLayoutData", () => {
  afterEach(() => {
    resetWebLayoutDataConfigForTests();
  });
  test("returns null auth user when there is no session", async () => {
    const container = {
      has: () => false,
      resolve: () => {
        throw new Error("should not resolve");
      },
    } as unknown as ServiceContainer;

    const data = await resolveWebLayoutData(container);

    expect(data.authUser).toBeNull();
  });

  test("returns email for the authenticated session user", async () => {
    const container = {
      has: (token: string) => token === CORE_TOKEN_SERVICE_TOKEN,
      resolve: () => ({
        findByIdOrThrow: async (id: number) => ({
          id,
          email: "admin@hiroapp.com",
          role: "admin",
        }),
      }),
    } as unknown as ServiceContainer;

    const data = await runWithAuthUser({ id: 7, role: "admin", abilities: ["*"] }, async () =>
      resolveWebLayoutData(container),
    );

    expect(data.authUser).toEqual({
      id: 7,
      email: "admin@hiroapp.com",
      role: "admin",
    });
  });

  test("loadUser receives the current Request", async () => {
    const request = new Request("http://example.test/forum?page=2", {
      headers: { cookie: "strata_session=abc" },
    });
    let seen: Request | undefined;
    configureWebLayoutData({
      userKey: "currentUser",
      loadUser: async (_container, incoming) => {
        seen = incoming;
        return { id: 3, email: "member@example.test", role: "member" };
      },
    });

    const container = {
      has: () => false,
      resolve: () => {
        throw new Error("should not resolve");
      },
    } as unknown as ServiceContainer;

    const data = await resolveWebLayoutData(container, request);

    expect(seen).toBe(request);
    expect(data.currentUser).toEqual({
      id: 3,
      email: "member@example.test",
      role: "member",
    });
    expect(data.cspNonce).toBe("");
  });
});
