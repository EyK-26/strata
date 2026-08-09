import type { NotificationRecord } from "./notificationTypes";
import type { UserRecord } from "./types";

interface UserResource {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface NotificationResource {
  id: number;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

function toUserResource(record: UserRecord): UserResource {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
  };
}

function toNotificationResource(record: NotificationRecord): NotificationResource {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    body: record.body,
    data: record.data,
    read_at: record.read_at?.toISOString() ?? null,
    created_at: record.created_at.toISOString(),
  };
}

export type { NotificationResource, UserResource };
export { toNotificationResource, toUserResource };
