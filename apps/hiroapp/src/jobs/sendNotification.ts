import { Job } from "@getstrata/core/queue";
import { createTrackedJob } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";

export const SEND_NOTIFICATION_JOB = "hiroapp.notification.send";

export interface SendNotificationPayload {
  userId: number;
  type: string;
  data: Record<string, unknown>;
  email?: { to: string; subject: string; body: string };
}

export class SendNotificationJob extends Job<SendNotificationPayload> {
  override readonly maxAttempts = 3;

  override async handle(payload: SendNotificationPayload): Promise<void> {
    const { deliverNotification } = await import("../modules/notifications/service.ts");
    await deliverNotification(payload);
  }
}

export function registerHiroappJobs() {
  if (!jobRegistry.names().includes(SEND_NOTIFICATION_JOB)) {
    jobRegistry.register(SEND_NOTIFICATION_JOB, () => new SendNotificationJob());
  }
}

export function trackedSendNotificationJob() {
  return createTrackedJob(SEND_NOTIFICATION_JOB, new SendNotificationJob());
}
