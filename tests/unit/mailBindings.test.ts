import { expect, spyOn, test } from "bun:test";
import { CORE_MAIL_TOKEN, Mailer } from "@getstrata/core/mail/mailer";
import { createApplication } from "@getstrata/core/runtime/application";
import { createMailBindings } from "../../src/bootstrap/providers/mail";

test("explicit log mail binding delivers through the owned service and redacts delivery links", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const app = createApplication({ providers: [], services: createMailBindings({ driver: "log" }) });
  try {
    await app.start();
    await app.run(async (scope) => {
      await scope.resolve(CORE_MAIL_TOKEN).send({
        to: "recipient@example.test",
        subject: "Verify account",
        body: "Visit https://app.example.test/verify?token=secret",
      });
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      channel: "mail",
      to: "recipient@example.test",
      body: "Visit [redacted-url]",
    });
  } finally {
    await app.stop();
    log.mockRestore();
  }
});

test("mail bindings reject unknown drivers and missing custom capabilities instead of falling back", () => {
  for (const options of [
    { driver: "unknown" },
    { driver: "custom" },
    { driver: "custom", mail: null },
    { driver: "custom", mail: {} },
    { driver: "custom", mail: { send: true } },
  ]) {
    expect(() => createMailBindings(options as never)).toThrow(
      "Unknown mail driver or missing custom send capability.",
    );
  }
});

test("SMTP binding validates and captures settings before startup without opening a transport", async () => {
  const smtp = { host: "127.0.0.1", port: 1, from: "sender@example.test", secure: false };
  const bindings = createMailBindings({ driver: "smtp", smtp });
  smtp.host = "";
  smtp.port = -1;
  const app = createApplication({ providers: [], services: bindings });
  try {
    await app.start();
    await app.run(async (scope) => {
      expect(scope.resolve(CORE_MAIL_TOKEN)).toBeInstanceOf(Mailer);
    });
  } finally {
    expect((await app.stop()).successful).toBe(true);
  }
});
