import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type NotificationRecord, notificationTable } from "./table.ts";

class NotificationRepository extends TenantRepository<NotificationRecord, "id"> {
  constructor() {
    super(notificationTable);
  }
}

export const notifications = new NotificationRepository();
export type { NotificationRecord };
