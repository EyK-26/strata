import { afterEach, describe, expect, mock, test } from "bun:test";
import { createAppSchedule } from "@getstrata/bootstrap/schedule";
import { type AuditExportSql, createAuditExporter } from "@getstrata/core/audit/exportAuditLogs";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/testing";
import { restoreEnvVar } from "../helpers/restoreEnv";

// These tests exercise callbacks directly, not scheduler admission/ownership.
const callbackContext = {
  taskName: "callback-test",
  occurrenceId: "0",
  scheduledAt: new Date(0),
  signal: new AbortController().signal,
  assertOwnership: async () => {},
};
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

let app: ReturnType<typeof createApplication> | undefined;
const runSql: AuditExportSql = (work) => {
  if (!app) throw new Error("Schedule application has not started");
  return app.run((scope) =>
    scope.resolve(DATABASE_SESSION_TOKEN).connection("main").transaction(work),
  );
};
async function insertPendingAuditLogs(count: number): Promise<void> {
  await runSql(async (database) => {
    for (let index = 0; index < count; index++) {
      await database.execute({
        text: "INSERT INTO audit_log (user_id,action,subject_type,subject_id,payload,tenant_id,created_at) VALUES (1,'task.created','task',?,?,1,CURRENT_TIMESTAMP)",
        params: [10 + index, JSON.stringify({ title: `Schedule export ${index}` })],
      });
    }
  });
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  resetDnsLookupForTests();
  delete process.env.SIEM_EXPORT_URL;
  delete process.env.SIEM_EXPORT_FORMAT;
  delete process.env.SIEM_EXPORT_BATCH_SIZE;
  delete process.env.SIEM_EXPORT_TOKEN;
  if (app) {
    expect((await app.stop()).successful).toBe(true);
    app = undefined;
  }
});

describe("bootstrap schedule", () => {
  test("registers heartbeat and audit-export tasks", async () => {
    const previousSiemExport = process.env.FEATURE_SIEM_EXPORT;
    const output = captureConsole();

    try {
      app = createApplication({
        providers: [],
        services: createDatabaseBindings({
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
        }),
      });
      await app.start();
      await runSql((database) =>
        database.execute({
          text: "CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, subject_type TEXT, subject_id INTEGER, payload TEXT, tenant_id INTEGER, created_at TEXT, exported_at TEXT, ip_address TEXT, user_agent TEXT, checksum TEXT, trace_id TEXT)",
          params: [],
        }),
      );
      const schedule = (enabled: boolean) => {
        const environment = { ...process.env, FEATURE_SIEM_EXPORT: String(enabled) };
        return createAppSchedule({
          environment,
          auditExport: createAuditExporter({ environment, runSql }),
          invoke: (envelope, work) => {
            if (!app) throw new Error("Schedule application has not started");
            return app.run(envelope, () => work());
          },
        });
      };
      const tasks = schedule(false).dueTasks();
      const heartbeat = tasks.find((task) => task.name === "heartbeat");
      const auditExport = tasks.find((task) => task.name === "audit-export");

      expect(heartbeat).toBeDefined();
      expect(auditExport).toBeDefined();

      await heartbeat?.run(callbackContext);
      expect(output.logs.some((line) => line.includes("Scheduler heartbeat"))).toBe(true);

      process.env.FEATURE_SIEM_EXPORT = "false";
      await auditExport?.run(callbackContext);
      expect(output.logs.some((line) => line.includes("Exported"))).toBe(false);

      process.env.FEATURE_SIEM_EXPORT = "true";
      process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-schedule";
      setDnsLookupForTests(async () => [{ address: "1.1.1.1", family: 4 }]);

      await insertPendingAuditLogs(3);

      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("accepted", { status: 200 })),
      ) as unknown as typeof fetch;

      const enabledExport = schedule(true)
        .dueTasks()
        .find((task) => task.name === "audit-export");
      await enabledExport?.run(callbackContext);
      expect(output.logs.some((line) => line.includes("Exported 3 audit log entries"))).toBe(true);

      await enabledExport?.run(callbackContext);
      expect(
        output.logs.filter((line) => line.includes("Exported 0 audit log entries")),
      ).toHaveLength(0);

      await insertPendingAuditLogs(1);
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("fail", { status: 503 })),
      ) as unknown as typeof fetch;

      await enabledExport?.run(callbackContext);
      expect(output.errors.some((line) => line.includes("Audit export failed."))).toBe(true);
    } finally {
      output.restore();
      restoreEnvVar("FEATURE_SIEM_EXPORT", previousSiemExport);
    }
  });
});
