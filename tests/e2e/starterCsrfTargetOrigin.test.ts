import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed generated app admits HTTPS proxy forms with explicit target and host policy", async () => {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../scripts/verify-starter-csrf-origin.ts")],
    {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, MAIL_DRIVER: "log" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120000,
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 });
  expect(stdout).toContain('"generatedProvider":true');
  expect(stdout).toContain('"adapter":false');
  expect(stdout).toContain('"browser":422');
  expect(stdout).toContain('"securityControls":true');
  expect(stdout).toContain('"malformedHostControls":true');
}, 125000);
