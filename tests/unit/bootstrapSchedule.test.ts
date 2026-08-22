import { afterEach, describe, expect, mock, test } from "bun:test";
import { appSchedule } from "@getstrata/bootstrap/schedule";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import db from "../../src/db/connection";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { clearPendingAuditLogs } from "./testHelpers";

const originalFetch = globalThis.fetch;

function captureConsole(): {
  logs: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

async function insertPendingAuditLogs(count: number): Promise<void> {
  await runWithMigrationBypass(async () => {
    for (let index = 0; index < count; index += 1) {
      await db`
        INSERT INTO audit_log (user_id, action, subject_type, subject_id, payload, tenant_id, created_at)
        VALUES (
          1,
          'task.created',
          'task',
          ${10 + index},
          ${JSON.stringify({ title: `Schedule export ${index}` })}::jsonb,
          1,
          NOW()
        )
      `;
    }
  });
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.SIEM_EXPORT_URL;
  delete process.env.SIEM_EXPORT_FORMAT;
  delete process.env.SIEM_EXPORT_BATCH_SIZE;
  delete process.env.SIEM_EXPORT_TOKEN;
  await clearPendingAuditLogs();
});

describe("bootstrap schedule", () => {
  test("registers heartbeat and audit-export tasks", async () => {
    const previousSiemExport = process.env.FEATURE_SIEM_EXPORT;
    const output = captureConsole();

    try {
      const tasks = appSchedule.dueTasks();
      const heartbeat = tasks.find((task) => task.name === "heartbeat");
      const auditExport = tasks.find((task) => task.name === "audit-export");

      expect(heartbeat).toBeDefined();
      expect(auditExport).toBeDefined();

      await heartbeat?.run();
      expect(output.logs.some((line) => line.includes("Scheduler heartbeat"))).toBe(true);

      process.env.FEATURE_SIEM_EXPORT = "false";
      await auditExport?.run();
      expect(output.logs.some((line) => line.includes("Exported"))).toBe(false);

      process.env.FEATURE_SIEM_EXPORT = "true";
      process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-schedule";
      await insertPendingAuditLogs(3);

      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("accepted", { status: 200 })),
      ) as unknown as typeof fetch;

      await auditExport?.run();
      expect(output.logs.some((line) => line.includes("Exported 3 audit log entries"))).toBe(true);

      await auditExport?.run();
      expect(
        output.logs.filter((line) => line.includes("Exported 0 audit log entries")),
      ).toHaveLength(0);

      await insertPendingAuditLogs(1);
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("fail", { status: 503 })),
      ) as unknown as typeof fetch;

      await auditExport?.run();
      expect(output.errors.some((line) => line.includes("Audit export failed."))).toBe(true);
    } finally {
      output.restore();
      restoreEnvVar("FEATURE_SIEM_EXPORT", previousSiemExport);
    }
  });
});
