import { describe, expect, test } from "bun:test";
import {
  assertSafeSmtpAddress,
  assertSafeSmtpField,
  buildSmtpPayload,
  defaultSmtpTransport,
  LogMailDriver,
  Mailer,
  redactMailBody,
  resolveSmtpConfig,
  SmtpMailDriver,
  smtpEnvelopeAddress,
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

  test("rejects CR or LF in SMTP envelope fields", () => {
    const mailer = new Mailer(new LogMailDriver());
    expect(() =>
      mailer.send({
        to: "victim@example.test\r\nBcc: attacker@evil.test",
        subject: "Hello",
        body: "Hi",
      }),
    ).toThrow("CR or LF");
    expect(() =>
      mailer.send({
        to: "user@example.test",
        subject: "Hello\nX-Injected: yes",
        body: "Hi",
      }),
    ).toThrow("CR or LF");
    expect(() => assertSafeSmtpField("ok\r", "subject")).toThrow("CR or LF");
    expect(() => assertSafeSmtpAddress("not-an-email", "to")).toThrow("valid email address");
    expect(assertSafeSmtpAddress("Name <user@example.test>", "from")).toBe(
      "Name <user@example.test>",
    );
    expect(smtpEnvelopeAddress("Name <user@example.test>", "from")).toBe("user@example.test");
    expect(() => smtpEnvelopeAddress("Name <not-an-email>", "from")).toThrow("valid email address");
  });

  test("rejects CR or LF in SMTP AUTH username or password before writing credentials", async () => {
    await expect(
      defaultSmtpTransport(
        {
          host: "127.0.0.1",
          port: 1,
          from: "mailer@example.test",
          secure: false,
          username: "smtp-user\r\nAUTH",
          password: "secret",
        },
        { to: "user@example.test", subject: "Hello", body: "Hi" },
      ),
    ).rejects.toThrow(/username must not contain CR or LF/);
    await expect(
      defaultSmtpTransport(
        {
          host: "127.0.0.1",
          port: 1,
          from: "mailer@example.test",
          secure: false,
          username: "smtp-user",
          password: "secret\nQUIT",
        },
        { to: "user@example.test", subject: "Hello", body: "Hi" },
      ),
    ).rejects.toThrow(/password must not contain CR or LF/);
    await expect(
      defaultSmtpTransport(
        {
          host: "127.0.0.1",
          port: 1,
          from: "mailer@example.test",
          secure: false,
        },
        { to: "user@example.test", subject: "Hello", body: "Hi" },
      ),
    ).rejects.not.toThrow(/CR or LF/);
  });

  test("redacts reset URLs and token-like query strings from the log body", async () => {
    expect(
      redactMailBody(
        "Reset at https://app.example.test/reset-password?token=abc123&expires=99 and keep hello",
      ),
    ).toBe("Reset at [redacted-url] and keep hello");
    expect(redactMailBody("fallback ?token=abc123 leftover")).toBe(
      "fallback [redacted-query] leftover",
    );

    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => {
      messages.push(String(value));
    };
    try {
      await new Mailer(new LogMailDriver()).send({
        to: "user@example.test",
        subject: "Reset",
        body: "Click https://app.example.test/reset?token=super-secret",
      });
    } finally {
      console.log = originalLog;
    }
    expect(messages[0]).toContain("[redacted-url]");
    expect(messages[0]).not.toContain("super-secret");
  });
  test("SMTP validates deadlines/ports and rejects already-aborted sends before connecting", async () => {
    const config = { host: "127.0.0.1", port: 1, from: "sender@example.test", secure: false };
    const message = { to: "recipient@example.test", subject: "Synthetic", body: "Fixture" };
    for (const timeoutMs of [0, -1, Number.NaN, Infinity, 0.5, 2147483648]) {
      await expect(defaultSmtpTransport({ ...config, timeoutMs }, message)).rejects.toThrow(
        /timeoutMs/,
      );
    }
    await expect(defaultSmtpTransport({ ...config, port: 65536 }, message)).rejects.toThrow(/port/);
    await expect(
      defaultSmtpTransport({ ...config, username: "synthetic-user" }, message),
    ).rejects.toThrow(/both username and password/);
    await expect(
      defaultSmtpTransport({ ...config, password: "synthetic-password" }, message),
    ).rejects.toThrow(/both username and password/);
    await expect(
      defaultSmtpTransport(config, { ...message, to: `${"x".repeat(65)}@example.test` }),
    ).rejects.toThrow(/length limit/);
    const reason = new Error("Synthetic pre-connect cancellation");
    expect(
      await defaultSmtpTransport(config, { ...message, signal: AbortSignal.abort(reason) }).catch(
        (error) => error,
      ),
    ).toBe(reason);
    const previous = {
      MAIL_TIMEOUT_MS: process.env.MAIL_TIMEOUT_MS,
      MAIL_HOST: process.env.MAIL_HOST,
      MAIL_FROM: process.env.MAIL_FROM,
    };
    try {
      process.env.MAIL_HOST = "localhost";
      process.env.MAIL_FROM = "sender@example.test";
      process.env.MAIL_TIMEOUT_MS = "125";
      const smtp = resolveSmtpConfig();
      expect(smtp.timeoutMs).toBe(125);
      process.env.MAIL_TIMEOUT_MS = "125bad";
      expect(() => resolveSmtpConfig()).toThrow(/timeoutMs/);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  test("SMTP framing normalizes line endings, escapes dots, and has exactly one terminator", () => {
    const payload = buildSmtpPayload("sender@example.test", {
      to: "recipient@example.test",
      subject: "Fixture",
      body: ".\n..value\r.\r\nafter",
    });
    expect(payload.endsWith("\r\n.\r\n")).toBe(true);
    expect(payload.match(/\r\n\.\r\n/gu)).toHaveLength(1);
    expect(payload).toContain("\r\n..\r\n...value\r\n..\r\nafter\r\n.\r\n");
    expect(payload.replace(/\r\n/gu, "")).not.toMatch(/[\r\n]/u);
  });
  test("SMTP MIME encodes Unicode headers/text and folds long body lines", () => {
    const subject = "Čau 🛒 ".repeat(25),
      body = `Příliš žluťoučký 🛒\n.\n${"x".repeat(1500)}`;
    const payload = buildSmtpPayload("Žluťoučký <sender@example.test>", {
      to: "recipient@example.test",
      subject,
      body,
    });
    const [headers, encoded] = payload.split("\r\n\r\n");
    expect(headers).toContain("Content-Transfer-Encoding: base64");
    const subjectLines = headers?.split("Subject: ")[1]?.split("\r\nMIME-Version")[0] ?? "";
    const words = [...subjectLines.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gu)];
    expect(words.every((word) => word[0].length <= 75)).toBe(true);
    expect(
      words.map((word) => Buffer.from(word[1] ?? "", "base64").toString("utf8")).join(""),
    ).toBe(subject);
    expect(Buffer.from(encoded?.slice(0, -5) ?? "", "base64").toString("utf8")).toBe(
      body.replace(/\n/gu, "\r\n"),
    );
    expect(payload.split("\r\n").every((line) => line.length <= 998)).toBe(true);
  });
  test("SMTP multipart delimiters differ and unsupported Unicode envelopes fail before connect", async () => {
    const message = {
      to: "recipient@example.test",
      subject: "Fixture",
      body: "ascii",
      html: "<p>ascii</p>",
    };
    const first = buildSmtpPayload("sender@example.test", message),
      second = buildSmtpPayload("sender@example.test", message);
    expect(first.match(/boundary="([^"]+)"/u)?.[1]).not.toBe(
      second.match(/boundary="([^"]+)"/u)?.[1],
    );
    await expect(
      defaultSmtpTransport(
        { host: "127.0.0.1", port: 1, from: "sender@example.test", secure: false },
        { ...message, to: "čau@example.test" },
      ),
    ).rejects.toThrow(/SMTPUTF8/);
    expect(() =>
      buildSmtpPayload("sender@example.test", { ...message, subject: "unsafe\x00" }),
    ).toThrow(/control characters/);
  });
});
