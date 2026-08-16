import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { notificationTable } from "./notificationTable";
import type { NotificationRecord } from "./notificationTypes";

class NotificationRepository extends BaseRepository<NotificationRecord, "id"> {
  constructor() {
    super(notificationTable);
  }
}

export default NotificationRepository;
