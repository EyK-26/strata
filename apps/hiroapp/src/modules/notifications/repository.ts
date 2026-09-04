import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type NotificationRecord, notificationTable } from "./table.ts";

class NotificationRepository extends BaseRepository<NotificationRecord, "id"> {
  constructor() {
    super(notificationTable);
  }
}

export const notifications = new NotificationRepository();
export type { NotificationRecord };
