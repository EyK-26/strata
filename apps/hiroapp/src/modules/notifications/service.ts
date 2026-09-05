import { randomUUID } from "node:crypto";
import { resolveApplicationQueue } from "@getstrata/bootstrap/applicationRegistry";
import { mailer } from "@getstrata/core/mail/mailer";
import type {
  DatabaseNotificationPayload,
  DatabaseNotificationStore,
  MailNotificationMessage,
  Notifiable,
  NotificationChannelName,
} from "@getstrata/core/notifications";
import { createNotificationDispatcher, Notification } from "@getstrata/core/notifications";
import { trackedSendNotificationJob } from "../../jobs/sendNotification.ts";
import type { Notification as NotificationRow } from "../../models/Notification.ts";
import { User } from "../../models/User.ts";

class HiringMailNotification extends Notification<Notifiable> {
  constructor(
    private readonly input: {
      type: string;
      data: Record<string, unknown>;
      email?: { to: string; subject: string; body: string };
    },
  ) {
    super();
  }

  override via(_notifiable: Notifiable): NotificationChannelName[] {
    return this.input.email ? ["database", "mail"] : ["database"];
  }

  override toMail(_notifiable: Notifiable): MailNotificationMessage | null {
    if (!this.input.email) {
      return null;
    }
    return {
      subject: this.input.email.subject,
      body: this.input.email.body,
    };
  }

  override toDatabase(_notifiable: Notifiable): DatabaseNotificationPayload | null {
    return {
      type: this.input.type,
      title: String(this.input.data.subject ?? this.input.type),
      body: String(this.input.data.text ?? this.input.email?.body ?? ""),
      data: this.input.data,
      notifiableType: "App\\Models\\User",
    };
  }
}

const hiringNotificationStore: DatabaseNotificationStore = {
  async create(input) {
    const owner = await User.findOrFail(input.userId);
    const created = await owner.notifications().create({
      id: randomUUID(),
      type: input.type,
      data: input.data ?? { title: input.title, body: input.body },
      read_at: null,
    });
    return (created as NotificationRow).toObject();
  },
};

export async function deliverNotification(input: {
  userId: number;
  type: string;
  data: Record<string, unknown>;
  email?: { to: string; subject: string; body: string };
}) {
  let created: Record<string, unknown> | null = null;
  const store: DatabaseNotificationStore = {
    async create(record) {
      created = await hiringNotificationStore.create(record);
      return created;
    },
  };
  const dispatcher = createNotificationDispatcher(mailer(), store);
  const notifiable: Notifiable = {
    getNotificationKey: () => input.userId,
    routeNotificationFor: (channel) =>
      channel === "mail" ? (input.email?.to ?? null) : input.userId,
  };
  await dispatcher.send(notifiable, new HiringMailNotification(input));
  return created ?? { type: input.type, data: input.data };
}

export async function notifyUser(input: {
  userId: number;
  type: string;
  data: Record<string, unknown>;
  email?: { to: string; subject: string; body: string };
}) {
  const job = trackedSendNotificationJob();
  try {
    await resolveApplicationQueue().dispatch(job, input);
  } catch {
    await job.handle(input);
  }
  return input;
}

export function contactUserNotification(from: string, to: string, subject: string, text: string) {
  return {
    type: "App\\Notifications\\ContactUser",
    data: { from, to, subject, text },
    email: {
      to,
      subject: `You have a new message from ${from}: ${subject}`,
      body: text,
    },
  };
}

export function interviewNotification(input: {
  text: string;
  datetime: string;
  place: string;
  sender: { first_name: string; last_name: string; email: string };
  to: string;
}) {
  const when = new Date(input.datetime);
  const formatted = Number.isNaN(when.getTime())
    ? input.datetime
    : when.toISOString().slice(0, 16).replace("T", " ");
  const subject = "Your Interview Details...";
  const body = `${input.text} \n when: ${formatted} \n where: ${input.place} \n Regards, ${input.sender.first_name} ${input.sender.last_name}`;
  return {
    type: "App\\Notifications\\InterviewInvitation",
    data: {
      datetime: input.datetime,
      place: input.place,
      text: body,
      from: input.sender.email,
      subject,
    },
    email: {
      to: input.to,
      subject: "Invitation to Interview",
      body,
    },
  };
}

export function endedNotification(input: {
  firstName: string;
  positionName: string;
  recruiter: { first_name: string; last_name: string; email: string };
  to: string;
}) {
  const subject = "We have updates for you";
  const text = `Dear ${input.firstName}, \n We are sorry to inform you that for the position of ${input.positionName}, we decided to continue with other candidates whose profile match our requirements. \n Wishing you the best. \n Regards, ${input.recruiter.first_name} ${input.recruiter.last_name}`;
  return {
    type: "App\\Notifications\\ApplicationEnded",
    data: { text, from: input.recruiter.email, subject },
    email: { to: input.to, subject: "Application Ended", body: text },
  };
}

export function hiredNotification(input: {
  firstName: string;
  positionName: string;
  recruiter: { first_name: string; last_name: string; email: string };
  to: string;
}) {
  const subject = "We have good news for you!";
  const text = `Dear ${input.firstName}, \n You have been hired as a ${input.positionName}. \n Regards, ${input.recruiter.first_name} ${input.recruiter.last_name}`;
  return {
    type: "App\\Notifications\\AcceptedForPosition",
    data: { text, from: input.recruiter.email, subject },
    email: { to: input.to, subject: `Hired for ${input.positionName}`, body: text },
  };
}
