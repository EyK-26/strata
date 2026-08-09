import type {
  DatabaseNotificationPayload,
  MailNotificationMessage,
  NotificationChannelName,
} from "./types.ts";

abstract class Notification<TNotifiable = unknown> {
  via(_notifiable: TNotifiable): NotificationChannelName[] {
    throw new Error("Notification subclasses must implement via().");
  }

  toMail(_notifiable: TNotifiable): MailNotificationMessage | null {
    return null;
  }

  toDatabase(_notifiable: TNotifiable): DatabaseNotificationPayload | null {
    return null;
  }
}

export { Notification };
