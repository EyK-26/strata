import { NotFoundError } from "@getstrata/core/errors/http";
import type { PaginatedResult } from "@getstrata/core/pagination";
import type NotificationRepository from "./notificationRepository";
import type { NotificationRecord } from "./notificationTypes";

interface CreateNotificationInput {
  userId: number;
  tenantId: number;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  listForUser(
    userId: number,
    options: { page: number; perPage: number; unreadOnly?: boolean },
  ): Promise<PaginatedResult<NotificationRecord>> {
    const where: Record<string, unknown> = { user_id: userId };

    if (options.unreadOnly) {
      where.read_at = null;
    }

    return this.repository.paginate({
      page: options.page,
      perPage: options.perPage,
      where: where as never,
    });
  }

  async markRead(userId: number, notificationId: number): Promise<NotificationRecord> {
    const notification = await this.repository.findByIdOrThrow(
      notificationId,
      (id) => new NotFoundError(`Notification ${id} not found.`),
    );

    if (notification.user_id !== userId) {
      throw new NotFoundError(`Notification ${notificationId} not found.`);
    }

    if (notification.read_at) {
      return notification;
    }

    return await this.repository.updateByIdOrThrow(notificationId, {
      read_at: new Date(),
    });
  }

  async markAllRead(userId: number): Promise<number> {
    const unread = await this.repository.findAll({
      where: { user_id: userId, read_at: null } as never,
    });

    let updated = 0;

    for (const notification of unread) {
      await this.repository.updateById(notification.id, { read_at: new Date() });
      updated += 1;
    }

    return updated;
  }

  create(input: CreateNotificationInput): Promise<NotificationRecord> {
    return this.repository.create({
      user_id: input.userId,
      tenant_id: input.tenantId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      read_at: null,
      created_at: new Date(),
    });
  }
}

export default NotificationService;
export type { CreateNotificationInput };
