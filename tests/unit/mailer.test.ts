import { describe, expect, test } from "bun:test";
import {
  LogMailDriver,
  Mailer,
  resolveSmtpConfig,
  SmtpMailDriver,
} from "@getstrata/core/mail/mailer";

describe("Mailer", () => {
  test("log driver records outgoing messages", async () => {
    const messages: string[] = [];
    const originalLog = console.log;

    console.log = (value?: unknown) => {
      messages.push(String(value));
    };

    try {
      const mailer = new Mailer(new LogMailDriver());
      await mailer.send({
        to: "admin@strata.test",
        subject: "Welcome",
        body: "Hello from Strata",
      });
    } finally {
      console.log = originalLog;
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("admin@strata.test");
    expect(messages[0]).toContain("Welcome");
  });

  test("log driver records html size instead of dumping the document", async () => {
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => {
      messages.push(String(value));
    };

    try {
      const mailer = new Mailer(new LogMailDriver());
      await mailer.send({
        to: "candidate@strata.test",
        subject: "Application received",
        body: "Hello",
        html: "<!DOCTYPE html><html><body>huge hiring template</body></html>",
      });
    } finally {
      console.log = originalLog;
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("htmlBytes");
    expect(messages[0]).not.toContain("<!DOCTYPE html>");
    expect(messages[0]).not.toContain("huge hiring template");
  });

  test("smtp driver delegates to the configured transport", async () => {
    const sent: Array<{ to: string; subject: string; body: string; html?: string }> = [];
    const config = {
      host: "smtp.example.test",
      port: 587,
      from: "noreply@strata.test",
      secure: false,
      username: "mailer",
      password: "secret",
    };

    const driver = new SmtpMailDriver(config, async (_config, message) => {
      sent.push(message);
    });

    await driver.send({
      to: "user@strata.test",
      subject: "Task assigned",
      body: "You have a new task.",
    });

    expect(sent).toEqual([
      {
        to: "user@strata.test",
        subject: "Task assigned",
        body: "You have a new task.",
      },
    ]);
  });

  test("resolveSmtpConfig reads mail environment variables", () => {
    const previous = {
      MAIL_HOST: process.env.MAIL_HOST,
      MAIL_PORT: process.env.MAIL_PORT,
      MAIL_FROM: process.env.MAIL_FROM,
      MAIL_USERNAME: process.env.MAIL_USERNAME,
      MAIL_PASSWORD: process.env.MAIL_PASSWORD,
      MAIL_SECURE: process.env.MAIL_SECURE,
    };

    process.env.MAIL_HOST = "smtp.mail.test";
    process.env.MAIL_PORT = "2525";
    process.env.MAIL_FROM = "noreply@strata.test";
    process.env.MAIL_USERNAME = "smtp-user";
    process.env.MAIL_PASSWORD = "smtp-pass";
    process.env.MAIL_SECURE = "true";

    try {
      expect(resolveSmtpConfig()).toEqual({
        host: "smtp.mail.test",
        port: 2525,
        from: "noreply@strata.test",
        username: "smtp-user",
        password: "smtp-pass",
        secure: true,
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("resolveSmtpConfig requires host and from address", () => {
    const previous = {
      MAIL_HOST: process.env.MAIL_HOST,
      MAIL_FROM: process.env.MAIL_FROM,
    };

    delete process.env.MAIL_HOST;
    delete process.env.MAIL_FROM;

    try {
      expect(() => resolveSmtpConfig()).toThrow('MAIL_DRIVER="smtp" requires MAIL_HOST to be set.');
      process.env.MAIL_HOST = "smtp.mail.test";
      expect(() => resolveSmtpConfig()).toThrow('MAIL_DRIVER="smtp" requires MAIL_FROM to be set.');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("buildSmtpPayload emits multipart alternative when html is present", async () => {
    const { buildSmtpPayload } = await import("@getstrata/core/mail/mailer");

    const payload = buildSmtpPayload("noreply@example.test", {
      to: "user@example.test",
      subject: "Welcome",
      body: "Plain text",
      html: "<p>HTML body</p>",
    });

    expect(payload).toContain("multipart/alternative");
    expect(payload).toContain("Plain text");
    expect(payload).toContain("<p>HTML body</p>");
  });
});
