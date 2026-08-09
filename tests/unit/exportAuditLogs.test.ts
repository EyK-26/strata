import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  exportPendingAuditLogs,
  resolveAuditExportConfig,
} from "@getstrata/core/audit/exportAuditLogs";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import db from "../../src/db/connection";
import { clearPendingAuditLogs } from "./testHelpers";

const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.SIEM_EXPORT_URL;
  delete process.env.SIEM_EXPORT_FORMAT;
  delete process.env.SIEM_EXPORT_BATCH_SIZE;
  delete process.env.SIEM_EXPORT_TOKEN;
  await clearPendingAuditLogs();
});

describe("resolveAuditExportConfig", () => {
  test("returns null when SIEM export is not configured", () => {
    expect(resolveAuditExportConfig()).toBeNull();
  });

  test("rejects private SIEM URLs", () => {
    process.env.SIEM_EXPORT_URL = "http://127.0.0.1:8080/ingest";

    expect(() => resolveAuditExportConfig()).toThrow();
  });

  test("resolves json export settings with defaults", () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem";

    expect(resolveAuditExportConfig()).toEqual({
      endpoint: "http://hooks.example.com/siem",
      format: "json",
      batchSize: 100,
    });
  });

  test("resolves cef export settings and normalizes invalid batch sizes", () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-cef";
    process.env.SIEM_EXPORT_FORMAT = "cef";
    process.env.SIEM_EXPORT_BATCH_SIZE = "not-a-number";

    expect(resolveAuditExportConfig()).toEqual({
      endpoint: "http://hooks.example.com/siem-cef",
      format: "cef",
      batchSize: 100,
    });
  });

  test("uses a configured batch size when it is a finite number", () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-batch";
    process.env.SIEM_EXPORT_BATCH_SIZE = "25";

    expect(resolveAuditExportConfig()?.batchSize).toBe(25);
  });
});

describe("exportPendingAuditLogs", () => {
  test("returns zero when export is disabled", async () => {
    await expect(exportPendingAuditLogs()).resolves.toBe(0);
  });

  test("returns zero when there are no pending audit logs", async () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-empty";

    await expect(exportPendingAuditLogs()).resolves.toBe(0);
  });

  test("exports pending audit logs as json without an auth token", async () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-json-no-token";

    await runWithMigrationBypass(async () => {
      await db`
        INSERT INTO audit_log (user_id, action, subject_type, subject_id, payload, tenant_id, created_at)
        VALUES (
          1,
          'task.created',
          'task',
          13,
          ${JSON.stringify({ title: "No token export" })}::jsonb,
          1,
          NOW()
        )
      `;
    });

    let authorization = "unset";

    globalThis.fetch = mock((_url, init) => {
      authorization = String(
        (init?.headers as Record<string, string> | undefined)?.authorization ?? "",
      );
      return Promise.resolve(new Response("accepted", { status: 200 }));
    }) as unknown as typeof fetch;

    const exported = await exportPendingAuditLogs();

    expect(exported).toBe(1);
    expect(authorization).toBe("");
  });

  test("exports pending audit logs as json and marks them exported", async () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-json";
    process.env.SIEM_EXPORT_TOKEN = "export-token";

    const inserted = (await runWithMigrationBypass(
      async () =>
        db`
      INSERT INTO audit_log (user_id, action, subject_type, subject_id, payload, tenant_id, created_at)
      VALUES (
        1,
        'task.created',
        'task',
        10,
        ${JSON.stringify({ title: "Export me" })}::jsonb,
        1,
        NOW()
      )
      RETURNING id
    `,
    )) as Array<{ id: number }>;

    let requestBody = "";
    let authorization = "";

    globalThis.fetch = mock((_url, init) => {
      requestBody = String(init?.body ?? "");
      authorization = String(
        (init?.headers as Record<string, string> | undefined)?.authorization ?? "",
      );
      return Promise.resolve(new Response("accepted", { status: 200 }));
    }) as unknown as typeof fetch;

    const exported = await exportPendingAuditLogs();

    expect(exported).toBe(1);
    expect(authorization).toBe("Bearer export-token");
    expect(JSON.parse(requestBody).events).toHaveLength(1);

    const row = (await runWithMigrationBypass(
      async () =>
        db`
      SELECT exported_at
      FROM audit_log
      WHERE id = ${inserted[0]!.id}
      LIMIT 1
    `,
    )) as Array<{ exported_at: Date | null }>;

    expect(row[0]?.exported_at).not.toBeNull();
  });

  test("exports pending audit logs as cef", async () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-cef-export";
    process.env.SIEM_EXPORT_FORMAT = "cef";

    await runWithMigrationBypass(async () => {
      await db`
        INSERT INTO audit_log (user_id, action, subject_type, subject_id, payload, tenant_id, created_at)
        VALUES (
          1,
          'task.updated',
          'task',
          11,
          ${JSON.stringify({ title: "CEF export" })}::jsonb,
          1,
          NOW()
        )
      `;
    });

    let contentType = "";

    globalThis.fetch = mock((_url, init) => {
      contentType = String(
        (init?.headers as Record<string, string> | undefined)?.["content-type"] ?? "",
      );
      return Promise.resolve(new Response("accepted", { status: 200 }));
    }) as unknown as typeof fetch;

    const exported = await exportPendingAuditLogs();

    expect(exported).toBe(1);
    expect(contentType).toBe("text/plain");
  });

  test("throws when the SIEM endpoint returns a non-success status", async () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-failure";

    await runWithMigrationBypass(async () => {
      await db`
        INSERT INTO audit_log (user_id, action, subject_type, subject_id, payload, tenant_id, created_at)
        VALUES (
          1,
          'task.deleted',
          'task',
          12,
          ${JSON.stringify({ title: "Failure export" })}::jsonb,
          1,
          NOW()
        )
      `;
    });

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("fail", { status: 503 })),
    ) as unknown as typeof fetch;

    await expect(exportPendingAuditLogs()).rejects.toThrow("SIEM export failed with status 503.");
  });
});
