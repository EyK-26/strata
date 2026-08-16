import { describe, expect, test } from "bun:test";
import type { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { runWithAuthUser } from "../../src/core/auth/authContext";
import { resolveWebLayoutData } from "../../src/core/view/webLayoutData";
import { tokenServiceToken } from "../../src/modules/user/provider";

describe("resolveWebLayoutData", () => {
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
      has: (token: string) => token === tokenServiceToken,
      resolve: () => ({
        findByIdOrThrow: async (id: number) => ({
          id,
          email: "admin@workhub.test",
          role: "admin",
        }),
      }),
    } as unknown as ServiceContainer;

    const data = await runWithAuthUser({ id: 7, role: "admin", abilities: ["*"] }, async () =>
      resolveWebLayoutData(container),
    );

    expect(data.authUser).toEqual({
      id: 7,
      email: "admin@workhub.test",
      role: "admin",
    });
  });
});
