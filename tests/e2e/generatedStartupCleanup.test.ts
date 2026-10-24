import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../helpers/generatedSecurityApp.ts";
import { installStartupProbe, STARTUP_PROBE_OPTIONS } from "../helpers/startupProbe.ts";

test("generated entrypoint retains native startup cause when provider close also fails", async () => {
  const fixture = await createGeneratedSecurityApp("sqlite", STARTUP_PROBE_OPTIONS);
  try {
    const target = await installStartupProbe(fixture.app);
    const input = join(fixture.app, "owned-startup-input.json");
    await writeFile(
      input,
      JSON.stringify({
        mode: "native-bind-close-failure",
        classification: "contract-control",
        expectedFactoryCalls: 1,
      }),
    );
    const env = {
      ...process.env,
      DATABASE_URL: fixture.runtimeUrl,
      APP_DATABASE_URL: fixture.runtimeUrl,
      MIGRATION_DATABASE_URL: fixture.migrationUrl,
      DB_CONNECTION: "sqlite",
      TENANCY_DRIVER: "none",
      CACHE_DRIVER: "array",
      QUEUE_DRIVER: "sync",
      MAIL_DRIVER: "log",
      APP_ENV: "local",
      APP_URL: "http://127.0.0.1:3000",
      AUTH_DEV_HEADERS: "true",
      OTEL_SDK_DISABLED: "true",
    };
    for (const args of [
      [join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "migrate"],
      ["run", "check"],
      [join(target, "consumer.ts"), input, join(fixture.app, "owned-startup-result.json")],
    ]) {
      const child = Bun.spawn([process.execPath, ...args], {
        cwd: fixture.app,
        env,
        stdout: "inherit",
        stderr: "inherit",
        timeout: 45000,
        killSignal: "SIGTERM",
      });
      expect(await child.exited).toBe(0);
    }
  } finally {
    await fixture.close();
  }
}, 120000);
