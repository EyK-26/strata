import { describe, expect, test } from "bun:test";
import {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_TOKEN,
  CORE_AUTH_USER_DIRECTORY_TOKEN,
} from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { resolveWebLayoutData } from "@getstrata/core/view/webLayoutData";
import {
  enableDevAuthHeaders,
  guestGuardOptions,
  restoreDevAuthHeaders,
} from "../helpers/devAuthHeaders";
import { createMockDependencies } from "./testHelpers";

describe("ability checker vs auth user directory tokens", () => {
  test("binds AbilityChecker and AuthUserDirectory together without colliding", async () => {
    const directoryCalls: number[] = [];
    const checkerCalls: string[] = [];

    const container = new ServiceContainer();
    container.set(
      CORE_AUTH_TOKEN,
      new AuthManager(
        new GuestGuard(guestGuardOptions({ APP_ENV: "local", AUTH_DEV_HEADERS: "true" })),
      ),
    );
    container.set(CORE_ABILITY_CHECKER_TOKEN, {
      tokenCan: () => false,
      requireAbility: (_user: unknown, ability: string) => {
        checkerCalls.push(ability);
        throw new ForbiddenError("missing ability");
      },
    });
    container.set(CORE_AUTH_USER_DIRECTORY_TOKEN, {
      findByIdOrThrow: async (id: number) => {
        directoryCalls.push(id);
        return { id, email: "sibling@example.test", role: "member" };
      },
    });

    const kernel = createHttpKernel(
      createMockDependencies(
        container,
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
    );

    const handler = kernel.wrapApi(
      kernel.wrapAbility("projects:delete", async () => Response.json({ ok: true })),
    );

    const previous = enableDevAuthHeaders();
    try {
      const denied = await handler(
        new Request("http://example.test/projects/1", {
          headers: { "x-authenticated-user-id": "7", "x-authenticated-user-role": "member" },
        }),
      );
      expect(denied.status).toBe(403);
      expect(checkerCalls).toEqual(["projects:delete"]);

      const layout = await runWithAuthUser({ id: 7, role: "member", abilities: [] }, async () =>
        resolveWebLayoutData(container),
      );

      expect(layout.authUser).toEqual({
        id: 7,
        email: "sibling@example.test",
        role: "member",
      });
      expect(directoryCalls).toEqual([7]);
    } finally {
      restoreDevAuthHeaders(previous);
    }
  });

  test("does not use an AbilityChecker as an account lookup", async () => {
    const container = new ServiceContainer();
    container.set(CORE_ABILITY_CHECKER_TOKEN, {
      tokenCan: () => true,
      requireAbility: () => undefined,
    });

    const layout = await runWithAuthUser({ id: 3, role: "admin", abilities: ["*"] }, async () =>
      resolveWebLayoutData(container),
    );

    expect(layout.authUser).toEqual({
      id: 3,
      email: "",
      role: "admin",
    });
  });

  test("explicit layout options use currentUser and a custom loader", async () => {
    const options = {
      userKey: "currentUser" as const,
      loadUser: async () => ({
        id: 2,
        name: "Ada",
        email: "ada@example.test",
        is_admin: true,
        role: "admin",
      }),
      extra: { unreadCount: 4 },
    };

    const data = await resolveWebLayoutData(
      {
        has: () => false,
        resolve: () => {
          throw new Error("should not resolve");
        },
      },
      undefined,
      options,
    );

    expect(data.authUser).toBeUndefined();
    expect(data.currentUser).toEqual({
      id: 2,
      name: "Ada",
      email: "ada@example.test",
      is_admin: true,
      role: "admin",
    });
    expect(data.unreadCount).toBe(4);
    expect(data.csrfToken).toBe("");
  });
});
