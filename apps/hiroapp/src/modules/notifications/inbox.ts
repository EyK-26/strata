import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import type { Notification } from "../../models/Notification.ts";
import { User } from "../../models/User.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { contactUserNotification, notifyUser } from "./service.ts";

export type ContactPayload = {
  to: string;
  from: string;
  subject: string;
  text: string;
};

export class NotificationInboxService {
  async list(user: UserRecord) {
    return User.newFromRecord(user).notifications() as Promise<Notification[]>;
  }

  async markRead(user: UserRecord, id: string) {
    const row = (await User.newFromRecord(user)
      .notifications()
      .where({ id })
      .first()) as Notification | null;
    if (!row || row.get("read_at")) {
      return { ok: false as const };
    }
    await row.update({ read_at: new Date() });
    return { ok: true as const };
  }

  async contact(payload: ContactPayload) {
    const recipient = await users.findByEmail(payload.to);
    if (!recipient) {
      return { sent: false as const };
    }
    const message = contactUserNotification(
      payload.from,
      payload.to,
      payload.subject,
      payload.text,
    );
    await notifyUser({ userId: recipient.id, ...message });
    await recordHiringEvent(
      "user.contacted",
      { to: payload.to, from: payload.from, subject: payload.subject, user_id: recipient.id },
      { type: "user", id: recipient.id },
    );
    return { sent: true as const, user_id: recipient.id };
  }
}

export const inboxService = new NotificationInboxService();
