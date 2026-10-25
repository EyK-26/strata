import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const fixture = await createGeneratedSecurityApp("sqlite", [
  "--frontend=api",
  "--auth=headers",
  "--tenancy=none",
  "--cache=array",
  "--queue=sync",
  "--mail=smtp",
  "--no-mfa",
  "--no-email-verification",
  "--no-scim",
  "--no-metrics",
  "--no-docker",
]);
try {
  await writeFile(
    join(fixture.app, "mail-initialization.ts"),
    `import {strict as assert} from "node:assert";
await import("./src/bootstrap/preload.ts");
assert.equal(process.env.MAIL_DRIVER,"smtp");assert.equal(process.env.MAIL_HOST,undefined);
const {Mailer,mailer,createMailDriver}=await import("@getstrata/core/mail/mailer");
const {createApp}=await import("./src/bootstrap/createApp.ts");assert.equal(typeof createApp,"function");
let calls=0;const failure=new Error("owned-provider-error");const signal=AbortSignal.abort();
const custom=new Mailer({async send(message){calls++;assert.equal(message.signal,signal);if(calls===2)throw failure;}});
await custom.send({to:"fixture@example.test",subject:"fixture",body:"No network",signal});
await assert.rejects(custom.send({to:"fixture@example.test",subject:"fixture",body:"No network",signal}),error=>error===failure);assert.equal(calls,2);
assert.throws(()=>createMailDriver(),/requires MAIL_HOST/);assert.throws(()=>mailer(),/requires MAIL_HOST/);
process.env.MAIL_DRIVER="log";assert.equal(mailer(),mailer());
console.log(JSON.stringify({generatedSmtpCustomDriver:true,unusedSmtpNotInitialized:true,usedSmtpStillValidated:true,externalSends:0}));\n`,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("MAIL_")),
  );
  const p = Bun.spawn([process.execPath, "--no-env-file", "mail-initialization.ts"], {
    cwd: fixture.app,
    env: {
      ...env,
      MAIL_DRIVER: "smtp",
      APP_ENV: "local",
      DATABASE_URL: fixture.runtimeUrl,
      APP_DATABASE_URL: fixture.runtimeUrl,
      CACHE_DRIVER: "array",
      QUEUE_DRIVER: "sync",
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  assert.equal(exit, 0, stdout + stderr);
  assert.match(stdout, /"generatedSmtpCustomDriver":true/);
  console.log(stdout.trim());
} finally {
  await fixture.close();
}
