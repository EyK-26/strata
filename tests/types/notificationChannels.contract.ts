/** Compiled by check; intentionally not executed. */
import { ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_MAIL_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import type { MailSender } from "@getstrata/core/mail/mailer";
import { sendMarkdownMail } from "@getstrata/core/mail/markdownMailable";
import {
  createNotificationDispatcher,
  type NotificationChannel,
  type NotificationChannels,
} from "@getstrata/core/notifications";

export function notificationChannelContracts(): void {
  const sender: MailSender = {
    async send(message) {
      void message.subject;
    },
  };
  const container = new ServiceContainer();
  container.set(CORE_MAIL_TOKEN, sender);
  const resolved: MailSender = container.resolve(CORE_MAIL_TOKEN);
  const sms: NotificationChannel = {
    async send(recipient, notification) {
      recipient.routeNotificationFor("sms");
      notification.via(recipient);
    },
  };
  const channels: NotificationChannels = { sms };
  createNotificationDispatcher(resolved, undefined, channels);
  void sendMarkdownMail(sender, { to: "user@example.test", subject: "Hello", markdown: "Hi" });
  // @ts-expect-error A channel must expose the asynchronous delivery capability.
  const invalid: NotificationChannel = { send: () => "delivered" };
  void invalid;
  // @ts-expect-error A mail service must implement the mail sending capability.
  container.set(CORE_MAIL_TOKEN, {});
}
