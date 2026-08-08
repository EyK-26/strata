interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

interface MailDriver {
  send(message: MailMessage): Promise<void>;
}

class LogMailDriver implements MailDriver {
  async send(message: MailMessage): Promise<void> {
    console.log(
      JSON.stringify({
        level: "info",
        channel: "mail",
        to: message.to,
        subject: message.subject,
        body: message.body,
      }),
    );
  }
}

class Mailer {
  constructor(private readonly driver: MailDriver) {}

  send(message: MailMessage): Promise<void> {
    return this.driver.send(message);
  }
}

const appMailer = new Mailer(new LogMailDriver());

function mailer(): Mailer {
  return appMailer;
}

export { LogMailDriver, Mailer, mailer };
export type { MailDriver, MailMessage };
