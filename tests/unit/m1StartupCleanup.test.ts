import { expect, test } from "bun:test";
import { modes } from "../fixtures/m1StartupCleanup";

test.each(modes)(
  "M1 failed-startup cleanup: %s",
  async (mode) => {
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", "run", "tests/fixtures/m1StartupCleanup.ts", mode],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SKIP_FIXTURE_TEST_BOOTSTRAP: "1",
          APP_ENV: "test",
          DATABASE_URL: "sqlite://:memory:",
          APP_DATABASE_URL: "sqlite://:memory:",
          TENANCY_DRIVER: "none",
          CACHE_DRIVER: "array",
          QUEUE_DRIVER: "sync",
          MAIL_DRIVER: "log",
          STORAGE_DRIVER: "local",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
      },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit, [mode, stdout, stderr].join("\n")).toBe(0);
    const receipt = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
    expect(receipt.mode).toBe(mode);
    expect(receipt.accepted).toBe(true);
  },
  20_000,
);
