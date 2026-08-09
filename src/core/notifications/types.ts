type NotificationChannelName = "mail" | "database";

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
  NotificationChannelName,
};
