import { afterEach, describe, expect, test } from "bun:test";
import {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_TOKEN,
  CORE_AUTH_USER_DIRECTORY_TOKEN,
  CORE_TOKEN_SERVICE_TOKEN,
} from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import {
  configureWebLayoutData,
  resetWebLayoutDataConfigForTests,
  resolveWebLayoutData,
} from "@getstrata/core/view/webLayoutData";
import { createMockDependencies } from "./testHelpers";

describe("ability checker vs auth user directory tokens", () => {
  afterEach(() => {
    resetWebLayoutDataConfigForTests();
  });

  test("binds AbilityChecker and AuthUserDirectory together without colliding", async () => {
    const directoryCalls: number[] = [];
    const checkerCalls: string[] = [];

    const container = new ServiceContainer();
    container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
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
      resolveUserFromToken: async () => null,
    });
    container.set(CORE_TOKEN_SERVICE_TOKEN, {
      tokenCan: () => {
        throw new Error("CORE_TOKEN_SERVICE_TOKEN must not be used as AbilityChecker here");
      },
      requireAbility: () => {
        throw new Error("CORE_TOKEN_SERVICE_TOKEN must not be used as AbilityChecker here");
      },
      findByIdOrThrow: async () => {
        throw new Error("CORE_TOKEN_SERVICE_TOKEN must not be used as a user directory here");
      },
    });

    const kernel = createHttpKernel(
      createMockDependencies(
        container,
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
    );

    const handler = withMiddleware(...kernel.globalMiddleware())(
      kernel.wrapAbility("projects:delete", async () => Response.json({ ok: true })),
    );

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
  });

  test("does not call findByIdOrThrow on an AbilityChecker bound to CORE_TOKEN_SERVICE_TOKEN", async () => {
    const container = new ServiceContainer();
    container.set(CORE_TOKEN_SERVICE_TOKEN, {
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

  test("configureWebLayoutData uses currentUser and a custom loader", async () => {
    configureWebLayoutData({
      userKey: "currentUser",
      loadUser: async () => ({
        id: 2,
        name: "Ada",
        email: "ada@example.test",
        is_admin: true,
        role: "admin",
      }),
      extra: { unreadCount: 4 },
    });

    const data = await resolveWebLayoutData({
      has: () => false,
      resolve: () => {
        throw new Error("should not resolve");
      },
    });

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
