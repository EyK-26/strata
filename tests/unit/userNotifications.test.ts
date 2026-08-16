import { beforeAll, describe, expect, mock, test } from "bun:test";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { notificationServiceToken, tokenServiceToken } from "../../src/modules/user/provider";
import { createMockCache, createMockDependencies } from "./testHelpers";

type AuthControllerClass = typeof import("../../src/modules/user/controller").default;
type AuthControllerInstance = InstanceType<AuthControllerClass>;

let AuthControllerClass: AuthControllerClass;

const now = new Date("2026-01-01T00:00:00.000Z");

function createController(): AuthControllerInstance {
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, {
    requireUser: mock(async () => ({ id: 1, role: "admin" })),
  });
  container.set(tokenServiceToken, {
    findByIdOrThrow: mock(async () => ({
      id: 1,
      name: "Admin",
      email: "admin@workhub.test",
      role: "admin",
      tenant_id: 1,
      created_at: now,
      updated_at: now,
    })),
  });
  container.set(notificationServiceToken, {
    listForUser: mock(async () => ({
      data: [
        {
          id: 7,
          user_id: 1,
          tenant_id: 1,
          type: "task.assigned",
          title: "Assigned",
          body: "Task assigned.",
          data: {},
          read_at: null,
          created_at: now,
        },
      ],
      meta: { page: 1, per_page: 20, total: 1, last_page: 1 },
    })),
    markRead: mock(async () => ({
      id: 7,
      user_id: 1,
      tenant_id: 1,
      type: "task.assigned",
      title: "Assigned",
      body: "Task assigned.",
      data: {},
      read_at: now,
      created_at: now,
    })),
    markAllRead: mock(async () => 2),
  });

  return new AuthControllerClass(createMockDependencies(container, createMockCache()));
}

beforeAll(async () => {
  ({ default: AuthControllerClass } = await import("../../src/modules/user/controller"));
});

describe("AuthController notifications", () => {
  test("lists notifications for the current user", async () => {
    const controller = createController();

    const response = await controller.listNotifications(
      new Request("http://example.test/users/me/notifications"),
    );
    const payload = (await response.json()) as { data: Array<{ id: number }> };

    expect(response.status).toBe(200);
    expect(payload.data[0]?.id).toBe(7);
  });

  test("marks a notification as read", async () => {
    const controller = createController();
    const request = Object.assign(
      new Request("http://example.test/users/me/notifications/7/read", {
        method: "PATCH",
      }),
      { params: { id: "7" } },
    );

    const response = await controller.markNotificationRead(request);
    const payload = (await response.json()) as { read_at: string | null };

    expect(response.status).toBe(200);
    expect(payload.read_at).toBe(now.toISOString());
  });

  test("marks all notifications as read", async () => {
    const controller = createController();

    const response = await controller.markAllNotificationsRead(
      new Request("http://example.test/users/me/notifications", { method: "PATCH" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 2 });
  });
});
