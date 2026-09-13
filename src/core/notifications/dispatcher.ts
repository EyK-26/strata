import type { Mailer } from "../mail/mailer.ts";
import { buildMarkdownMailMessage } from "../mail/markdownMailable.ts";
import type { Notification } from "./notification.ts";
import type { DatabaseNotificationStore, Notifiable } from "./types.ts";

class NotificationDispatcher {
  constructor(
    private readonly mailer: Mailer,
    private readonly databaseStore: DatabaseNotificationStore | null = null,
  ) {}

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    for (const channel of notification.via(notifiable)) {
      if (channel === "mail") {
        await this.sendMail(notifiable, notification);
        continue;
      }

      if (channel === "database") {
        await this.sendDatabase(notifiable, notification);
      }
    }
  }

  private async sendMail(notifiable: Notifiable, notification: Notification): Promise<void> {
    const routed = notifiable.routeNotificationFor("mail");

    if (routed === null) {
      return;
    }

    const message = notification.toMail(notifiable);

    if (!message) {
      return;
    }

    if (message.markdown) {
      await this.mailer.send(
        buildMarkdownMailMessage({
          to: String(routed),
          subject: message.subject,
          markdown: message.markdown,
        }),
      );
      return;
    }

    await this.mailer.send({
      to: String(routed),
      subject: message.subject,
      body: message.body ?? "",
    });
  }

  private async sendDatabase(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!this.databaseStore) {
      return;
    }

    const payload = notification.toDatabase(notifiable);

    if (!payload) {
      return;
    }

    await this.databaseStore.create({
      userId: Number(notifiable.getNotificationKey()),
      ...payload,
    });
  }
}

function createNotificationDispatcher(
  mailer: Mailer,
  databaseStore?: DatabaseNotificationStore,
): NotificationDispatcher {
  return new NotificationDispatcher(mailer, databaseStore ?? null);
}

export { createNotificationDispatcher, NotificationDispatcher };
