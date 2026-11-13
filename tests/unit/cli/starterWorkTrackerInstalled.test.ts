import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../../helpers/generatedSecurityApp.ts";

for (const [database, transport, frontend] of [
  ["postgres", "cookie", "server-htmx"],
  ["sqlite", "token", "api"],
] as const) {
  test(`installed work tracker ${database}/${transport} shares tenant-safe audited transactional workflow`, async () => {
    const fixture = await createGeneratedSecurityApp(
      database,
      [
        `--frontend=${frontend}`,
        `--auth=${transport}`,
        "--no-mfa",
        "--no-email-verification",
        "--no-scim",
        "--no-metrics",
      ],
      { reference: "work-tracker" },
    );
    try {
      const types = Bun.spawnSync([process.execPath, "run", "check"], {
        cwd: fixture.app,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30000,
      });
      expect(types.exitCode, types.stdout.toString() + types.stderr.toString()).toBe(0);
      await writeFile(
        join(fixture.app, "acceptance.ts"),
        await readFile(join(import.meta.dir, "../../fixtures/work-tracker/acceptance.ts.txt")),
      );
      const result = Bun.spawnSync([process.execPath, "acceptance.ts"], {
        cwd: fixture.app,
        env: {
          ...process.env,
          DATABASE_URL: fixture.runtimeUrl,
          APP_DATABASE_URL: fixture.runtimeUrl,
          MIGRATION_DATABASE_URL: fixture.migrationUrl,
          APP_ENV: "local",
          FRONTEND_MODE: frontend,
          TENANCY_DRIVER: database === "postgres" ? "rls" : "column",
          AUTH_DEV_HEADERS: "false",
          TENANT_DEV_HEADERS: "true",
          SESSION_SECRET: "reference-acceptance-session-secret-1234567890",
          SIGNED_URL_SECRET: "reference-acceptance-signature-secret-1234567890",
          CACHE_DRIVER: "array",
          QUEUE_DRIVER: "sync",
          MAIL_DRIVER: "log",
          WORK_TRACKER_TRANSPORT: transport,
          WORK_TRACKER_DATABASE: database,
          FEATURE_EMAIL_VERIFICATION: "false",
          FEATURE_MFA: "false",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30000,
      });
      expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
      expect(result.stdout.toString()).toContain('"rollback":true');
      expect(result.stdout.toString()).toContain('"twoTenants":true');
      expect(result.stdout.toString()).toContain('"workerDelivery":true');
      expect(result.stdout.toString()).toContain('"idempotentRetry":true');
      if (database === "postgres") expect(result.stdout.toString()).toContain('"rls":true');
    } finally {
      await fixture.close();
    }
  }, 120000);
}
