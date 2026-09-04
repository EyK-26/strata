import { eventBus } from "@getstrata/core/events";
import { mailer } from "@getstrata/core/mail/mailer";
import { sendMarkdownMail } from "@getstrata/core/mail/markdownMailable";
import {
  APPLICATION_SUBMITTED,
  type ApplicationSubmittedPayload,
} from "../events/ApplicationSubmitted.ts";
import { User } from "../models/User.ts";
import { notifyUser } from "../modules/notifications/service.ts";

eventBus.listen(APPLICATION_SUBMITTED, async (payload) => {
  const { application } = payload as ApplicationSubmittedPayload;
  const applicant = await User.find(Number(application.get("user_id")));
  if (!applicant) {
    return;
  }

  const email = String(applicant.get("email"));
  const firstName = String(applicant.get("first_name"));
  const markdown = `Hello **${firstName}**,\n\nWe received your application.\n\nWe will be in touch soon.`;

  await sendMarkdownMail(mailer(), {
    to: email,
    subject: "Application received",
    markdown,
    layout: { title: "HiroApp", footer: "HiroApp hiring" },
  });

  await notifyUser({
    userId: Number(applicant.id),
    type: "App\\Notifications\\ApplicationSubmitted",
    data: {
      application_id: Number(application.id),
      from: "HiroApp",
      subject: "Application received",
    },
    email: {
      to: email,
      subject: "Application received",
      body: `Hello ${firstName}, we received your application.`,
    },
  });
});
