import type { MailSender } from "../mail/mailer.ts";
import { buildMarkdownMailMessage } from "../mail/markdownMailable.ts";
import type { Notification } from "./notification.ts";
import type { DatabaseNotificationStore, Notifiable, NotificationChannels } from "./types.ts";

class NotificationDispatcher {
  private readonly channels: NotificationChannels;

  constructor(
    private readonly mailer: MailSender,
    private readonly databaseStore: DatabaseNotificationStore | null = null,
    channels: NotificationChannels = {},
  ) {
    if (!mailer || typeof mailer.send !== "function") {
      throw new TypeError('Notification channel "mail" requires a mail sender.');
    }
    if (databaseStore && typeof databaseStore.create !== "function") {
      throw new TypeError('Notification channel "database" requires a database store.');
    }
    // Snapshot registrations so one application's configuration cannot mutate another's.
    const registrations = Object.create(null) as Record<string, NotificationChannels[string]>;
    registrations.mail = { send: (recipient, message) => this.sendMail(recipient, message) };
    if (databaseStore) {
      registrations.database = {
        send: (recipient, message) => this.sendDatabase(recipient, message),
      };
    }
    for (const [name, channel] of Object.entries(channels)) {
      if (!name || !channel || typeof channel.send !== "function") {
        throw new TypeError(`Invalid notification channel registration: "${name}".`);
      }
      // Capture the method and receiver, rather than a mutable registration property.
      const send = channel.send.bind(channel);
      registrations[name] = Object.freeze({ send });
    }
    this.channels = Object.freeze(registrations);
  }

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const channels = [...notification.via(notifiable)];
    // Validate all requested channels before any delivery side effects.
    const handlers = channels.map((name) => {
      const channel = Object.hasOwn(this.channels, name) ? this.channels[name] : undefined;
      if (!channel) {
        if (name === "database") {
          throw new Error('Notification channel "database" requires a database store.');
        }
        throw new Error(`Unsupported notification channel: "${name}".`);
      }
      return channel;
    });
    for (const channel of handlers) {
      await channel.send(notifiable, notification);
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
      ...(message.html !== undefined ? { html: message.html } : {}),
    });
  }

  private async sendDatabase(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!this.databaseStore) {
      throw new Error('Notification channel "database" requires a database store.');
    }

    const payload = notification.toDatabase(notifiable);

    if (!payload) {
      return;
    }

    const key = notifiable.getNotificationKey();
    const userId = typeof key === "string" && /^[0-9]+$/.test(key) ? Number(key) : key;
    if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0) {
      throw new TypeError(
        'Notification channel "database" requires a positive safe-integer user ID.',
      );
    }

    await this.databaseStore.create({
      ...payload,
      userId,
    });
  }
}

function createNotificationDispatcher(
  mailer: MailSender,
  databaseStore?: DatabaseNotificationStore,
  channels: NotificationChannels = {},
): NotificationDispatcher {
  return new NotificationDispatcher(mailer, databaseStore ?? null, channels);
}

export { createNotificationDispatcher, NotificationDispatcher };
