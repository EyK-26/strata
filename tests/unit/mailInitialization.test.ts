import { expect, test } from "bun:test";

const moduleUrl = import.meta.resolve("@getstrata/core/mail/mailer");
test("mail module exposes explicit owned construction without a global accessor", async () => {
  const exports = await import("@getstrata/core/mail/mailer");
  expect("mailer" in exports).toBe(false);
  const first = new exports.Mailer({ async send() {} });
  const second = new exports.Mailer({ async send() {} });
  expect(first).not.toBe(second);
});
async function fresh(script: string, driver = "smtp") {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("MAIL_")),
  );
  const p = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `import {strict as assert} from "node:assert";const {Mailer,createMailDriver,LogMailDriver}=await import(${JSON.stringify(moduleUrl)});${script}`,
    ],
    { env: { ...env, MAIL_DRIVER: driver }, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, exit };
}
test("custom MailDriver can import and send without configuring unused SMTP", async () => {
  expect(
    await fresh(
      `let calls=0;await new Mailer({async send(){calls++;}}).send({to:"fixture@example.test",subject:"fixture",body:"No external transport"});assert.equal(calls,1);`,
    ),
  ).toMatchObject({ exit: 0, stderr: "" });
});
test("explicit SMTP selection still rejects missing host and missing sender", async () => {
  expect(
    await fresh(
      `assert.throws(()=>createMailDriver(),/requires MAIL_HOST/);process.env.MAIL_HOST="smtp.example.test";assert.throws(()=>createMailDriver(),/requires MAIL_FROM/);`,
    ),
  ).toMatchObject({ exit: 0, stderr: "" });
});
test("custom provider failures and cancellation are not replaced with log delivery", async () => {
  expect(
    await fresh(
      `const failure=new Error("custom-provider-failure");const signal=AbortSignal.abort();let calls=0;const custom=new Mailer({async send(message){calls++;assert.equal(message.signal,signal);throw failure;}});await assert.rejects(custom.send({to:"fixture@example.test",subject:"fixture",body:"No external transport",signal}),error=>error===failure);assert.equal(calls,1);`,
    ),
  ).toMatchObject({ exit: 0, stderr: "" });
});
