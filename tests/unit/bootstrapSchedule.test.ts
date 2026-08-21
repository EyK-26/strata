import { afterAll, describe, expect, mock, test } from "bun:test";
import { restoreEnvVar } from "../helpers/restoreEnv";

afterAll(() => {
  mock.restore();
});

describe("bootstrap schedule", () => {
  test("registers heartbeat and audit-export tasks", async () => {
    const debugLogs: string[] = [];
    const infoLogs: string[] = [];
    const errorLogs: Array<{ message: string; context?: unknown }> = [];
    let exportedCount = 0;
    let exportShouldFail = false;
    const previousSiemExport = process.env.FEATURE_SIEM_EXPORT;

    mock.module("@getstrata/core/audit/exportAuditLogs", () => ({
      exportPendingAuditLogs: async () => {
        if (exportShouldFail) {
          throw new Error("export failed");
        }

        return exportedCount;
      },
    }));

    mock.module("@getstrata/core/logging/logger", () => ({
      appLogger: {
        debug: (message: string) => {
          debugLogs.push(message);
        },
        info: (message: string) => {
          infoLogs.push(message);
        },
        error: (message: string, context?: unknown) => {
          errorLogs.push({ message, context });
        },
      },
    }));

    try {
      await import("@getstrata/bootstrap/schedule");

      const { appSchedule } = await import("@getstrata/core/scheduler/schedule");
      const tasks = appSchedule.dueTasks();
      const heartbeat = tasks.find((task) => task.name === "heartbeat");
      const auditExport = tasks.find((task) => task.name === "audit-export");

      expect(heartbeat).toBeDefined();
      expect(auditExport).toBeDefined();

      await heartbeat?.run();
      expect(debugLogs).toContain("Scheduler heartbeat");

      process.env.FEATURE_SIEM_EXPORT = "false";
      await auditExport?.run();
      expect(infoLogs.some((line) => line.includes("Exported"))).toBe(false);

      process.env.FEATURE_SIEM_EXPORT = "true";
      exportedCount = 3;
      await auditExport?.run();
      expect(infoLogs.some((line) => line.includes("Exported 3 audit log entries"))).toBe(true);

      exportedCount = 0;
      await auditExport?.run();
      expect(infoLogs.filter((line) => line.includes("Exported 0 audit log entries"))).toHaveLength(
        0,
      );

      exportShouldFail = true;
      await auditExport?.run();
      expect(errorLogs.some((entry) => entry.message === "Audit export failed.")).toBe(true);
    } finally {
      mock.restore();

      if (previousSiemExport === undefined) {
        delete process.env.FEATURE_SIEM_EXPORT;
      } else {
        restoreEnvVar("FEATURE_SIEM_EXPORT", previousSiemExport);
      }
    }
  });
});
