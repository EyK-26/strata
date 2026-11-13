import { type FactoryServiceDeclaration, service } from "@getstrata/core/contracts/services";
import {
  CORE_MAIL_TOKEN,
  LogMailDriver,
  type MailDriver,
  Mailer,
  type SmtpConfig,
  SmtpMailDriver,
  snapshotSmtpConfig,
} from "@getstrata/core/mail/mailer";

type MailBindingOptions =
  | { readonly driver: "log" }
  | { readonly driver: "smtp"; readonly smtp: SmtpConfig }
  | { readonly driver: "custom"; readonly mail: MailDriver };

/** No transport opens during assembly; SMTP configuration is validated and copied here. */
function createMailBindings(options: MailBindingOptions): readonly FactoryServiceDeclaration[] {
  let create: () => MailDriver;
  if (options.driver === "smtp") {
    const snapshot = snapshotSmtpConfig(options.smtp);
    create = () => new SmtpMailDriver(snapshot);
  } else if (options.driver === "log") create = () => new LogMailDriver();
  else if (options.driver === "custom" && options.mail && typeof options.mail.send === "function") {
    const driver = options.mail;
    create = () => driver;
  } else throw new TypeError("Unknown mail driver or missing custom send capability.");
  return Object.freeze([
    service(CORE_MAIL_TOKEN, {
      lifetime: "application",
      dependencies: [] as const,
      create: () => new Mailer(create()),
    }),
  ]);
}

export type { MailBindingOptions };
export { CORE_MAIL_TOKEN, createMailBindings };
