import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import NotificationRepository from "../../src/modules/user/notificationRepository";
import NotificationService from "../../src/modules/user/notificationService";
import { defaultTestTenant } from "./testHelpers";

describe("NotificationService", () => {
  test("creates and lists notifications for a user", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      await runWithAuthUser({ id: 1, role: "admin" }, async () => {
        const service = new NotificationService(new NotificationRepository());
        const created = await service.create({
          userId: 1,
          tenantId: 1,
          type: "task.assigned",
          title: "New task",
          body: "You were assigned a task.",
          data: { task_id: 1 },
        });

        const listed = await service.listForUser(1, { page: 1, perPage: 10 });

        expect(created.title).toBe("New task");
        expect(listed.data.some((entry) => entry.id === created.id)).toBe(true);
      });
    });
  });

  test("marks one notification and all notifications as read", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      await runWithAuthUser({ id: 1, role: "admin" }, async () => {
        const service = new NotificationService(new NotificationRepository());
        const first = await service.create({
          userId: 1,
          tenantId: 1,
          type: "task.updated",
          title: "Task updated",
          body: "Status changed.",
        });
        const second = await service.create({
          userId: 1,
          tenantId: 1,
          type: "comment.created",
          title: "New comment",
          body: "Someone commented.",
        });

        const marked = await service.markRead(1, first.id);
        expect(marked.read_at).not.toBeNull();

        const updated = await service.markAllRead(1);
        expect(updated).toBeGreaterThanOrEqual(1);

        const unread = await service.listForUser(1, {
          page: 1,
          perPage: 10,
          unreadOnly: true,
        });
        expect(unread.data.some((entry) => entry.id === second.id)).toBe(false);
      });
    });
  });

  test("markRead returns existing records and rejects foreign notifications", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const service = new NotificationService(new NotificationRepository());
      const notification = await service.create({
        userId: 1,
        tenantId: 1,
        type: "task.updated",
        title: "Already read",
        body: "Done.",
      });

      const marked = await service.markRead(1, notification.id);
      const again = await service.markRead(1, notification.id);
      expect(again.read_at).toEqual(marked.read_at);

      await expect(service.markRead(2, notification.id)).rejects.toThrow(
        `Notification ${notification.id} not found.`,
      );
    });
  });
});
