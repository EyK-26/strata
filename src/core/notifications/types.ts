import type { Notification } from "./notification.ts";

/** Channel names belong to the application; built-ins retain editor completion. */
type NotificationChannelName = "mail" | "database" | (string & {});

/** An application-owned delivery capability. Failures propagate to the caller. */
interface NotificationChannel {
  send(notifiable: Notifiable, notification: Notification): Promise<void>;
}

type NotificationChannels = Readonly<Record<string, NotificationChannel>>;

interface MailNotificationMessage {
  subject: string;
  markdown?: string;
  body?: string;
  html?: string;
}

interface DatabaseNotificationPayload {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  notifiableType?: string | null;
  notifiableId?: number | null;
}

interface DatabaseNotificationStore {
  create(input: DatabaseNotificationPayload & { userId: number }): Promise<Record<string, unknown>>;
}

interface Notifiable {
  getNotificationKey(): string | number;
  routeNotificationFor(channel: NotificationChannelName): string | number | null;
}

export type {
  DatabaseNotificationPayload,
  DatabaseNotificationStore,
  MailNotificationMessage,
  Notifiable,
  NotificationChannel,
  NotificationChannelName,
  NotificationChannels,
};
