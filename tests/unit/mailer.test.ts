import { describe, expect, test } from "bun:test";
import { LogMailDriver, Mailer } from "../../src/core/mail/mailer";

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
        to: "admin@workhub.test",
        subject: "Welcome",
        body: "Hello from WorkHub",
      });
    } finally {
      console.log = originalLog;
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("admin@workhub.test");
    expect(messages[0]).toContain("Welcome");
  });
});
