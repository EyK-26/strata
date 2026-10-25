import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed generated SMTP consumer can use an independent custom driver without unused SMTP configuration", async () => {
  const p = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../scripts/verify-mail-initialization.ts")],
    {
      cwd: join(import.meta.dir, "../.."),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  expect({ stdout, stderr, exit }).toMatchObject({ exit: 0 });
  expect(stdout).toContain('"generatedSmtpCustomDriver":true');
  expect(stdout).toContain('"externalSends":0');
}, 65000);
