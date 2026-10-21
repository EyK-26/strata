import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  exportPendingAuditLogs,
  resolveAuditExportConfig,
} from "@getstrata/core/audit/exportAuditLogs";
import { hasActiveDatabaseConnection } from "@getstrata/core/database/connectionContext";
import { hasActiveTransaction } from "@getstrata/core/database/transaction";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/security/safeUrl";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { SQL } from "bun";
import db from "../../src/db/connection";
import { clearPendingAuditLogs } from "./testHelpers";

const originalFetch = globalThis.fetch;

function mockPublicDns(): void {
  setDnsLookupForTests(async () => [{ address: "1.1.1.1", family: 4 }]);
}

async function createPendingAudit(action: string): Promise<number> {
  const [created] = (await runWithMigrationBypass(
    async () => db`
      INSERT INTO audit_log (user_id, action, subject_type, subject_id, payload, tenant_id, created_at)
      VALUES (1, ${action}, 'task', 99, ${JSON.stringify({ title: "Export boundary" })}::jsonb, 1, NOW())
      RETURNING id
    `,
  )) as Array<{ id: number }>;
  expect(created).toBeDefined();
  if (!created) throw new Error("The audit fixture row must exist.");
  return created.id;
}

async function exportedAt(id: number): Promise<Date | null | undefined> {
  const [row] = (await runWithMigrationBypass(
    async () => db`SELECT exported_at FROM audit_log WHERE id = ${id}`,
  )) as Array<{ exported_at: Date | null }>;
  expect(row).toBeDefined();
  return row?.exported_at;
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  resetDnsLookupForTests();
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
  test("releases its own RLS transaction before the outbound HTTP boundary", async () => {
    const previousTenancy = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "rls";
    const databaseUrl = process.env.DATABASE_URL;
    expect(databaseUrl).toBeDefined();
    if (!databaseUrl) throw new Error("The real Postgres fixture is required.");
    const observer = new SQL(databaseUrl);
    try {
      mockPublicDns();
      process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-transaction-boundary";
      await createPendingAudit("transaction.boundary");

      let observed:
        | { transaction: boolean; connection: boolean; idleInTransaction: boolean }
        | undefined;
      globalThis.fetch = mock(async () => {
        const transaction = hasActiveTransaction();
        const connection = hasActiveDatabaseConnection();
        const [backend] = (await db`SELECT pg_backend_pid() AS pid`) as Array<{ pid: number }>;
        expect(backend?.pid).toBeGreaterThan(0);
        const [activity] = await observer.unsafe<Array<{ state: string }>>(
          "SELECT state FROM pg_stat_activity WHERE pid = $1",
          [backend?.pid],
        );
        expect(activity?.state).toBeDefined();
        observed = {
          transaction,
          connection,
          idleInTransaction: activity?.state.startsWith("idle in transaction") ?? false,
        };
        return new Response("accepted", { status: 200 });
      }) as unknown as typeof fetch;

      expect(await exportPendingAuditLogs()).toBe(1);
      expect(observed).toEqual({ transaction: false, connection: false, idleInTransaction: false });
    } finally {
      await observer.close();
      if (previousTenancy === undefined) delete process.env.TENANCY_DRIVER;
      else process.env.TENANCY_DRIVER = previousTenancy;
    }
  });

  test("acknowledges only the accepted snapshot when another row arrives during HTTP", async () => {
    mockPublicDns();
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-snapshot";
    const selected = await createPendingAudit("snapshot.selected");
    let arriving: number | undefined;
    globalThis.fetch = mock(async () => {
      arriving = await createPendingAudit("snapshot.arriving");
      return new Response("accepted", { status: 200 });
    }) as unknown as typeof fetch;

    expect(await exportPendingAuditLogs()).toBe(1);
    expect(await exportedAt(selected)).not.toBeNull();
    expect(arriving).toBeDefined();
    if (arriving === undefined) throw new Error("The concurrent audit fixture row must exist.");
    expect(await exportedAt(arriving)).toBeNull();
  });

  test("leaves an unaccepted snapshot pending when the HTTP sink fails", async () => {
    mockPublicDns();
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-pending";
    const selected = await createPendingAudit("sink.failed");
    globalThis.fetch = mock(
      async () => new Response("unavailable", { status: 503 }),
    ) as unknown as typeof fetch;

    await expect(exportPendingAuditLogs()).rejects.toThrow("SIEM export failed with status 503.");
    expect(await exportedAt(selected)).toBeNull();
  });

  test("does not commit or release a caller-owned transaction", async () => {
    mockPublicDns();
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-caller-transaction";
    const selected = await createPendingAudit("caller.owned");
    let accepted = 0;
    globalThis.fetch = mock(async () => {
      expect(hasActiveTransaction()).toBe(true);
      expect(hasActiveDatabaseConnection()).toBe(true);
      accepted++;
      return new Response("accepted", { status: 200 });
    }) as unknown as typeof fetch;
    const rollback = new Error("caller rollback after external acceptance");

    await expect(
      runWithMigrationBypass(async () => {
        expect(await exportPendingAuditLogs()).toBe(1);
        expect(hasActiveTransaction()).toBe(true);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(accepted).toBe(1);
    expect(await exportedAt(selected)).toBeNull();
  });

  test("returns zero when export is disabled", async () => {
    await expect(exportPendingAuditLogs()).resolves.toBe(0);
  });

  test("returns zero when there are no pending audit logs", async () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-empty";

    await expect(exportPendingAuditLogs()).resolves.toBe(0);
  });

  test("exports pending audit logs as json without an auth token", async () => {
    mockPublicDns();
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
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(new Response("accepted", { status: 200 }));
    }) as unknown as typeof fetch;

    const exported = await exportPendingAuditLogs();

    expect(exported).toBe(1);
    expect(authorization).toBe("");
  });

  test("exports pending audit logs as json and marks them exported", async () => {
    mockPublicDns();
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
      authorization = new Headers(init?.headers).get("authorization") ?? "";
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
    mockPublicDns();
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
      contentType = new Headers(init?.headers).get("content-type") ?? "";
      return Promise.resolve(new Response("accepted", { status: 200 }));
    }) as unknown as typeof fetch;

    const exported = await exportPendingAuditLogs();

    expect(exported).toBe(1);
    expect(contentType).toBe("text/plain");
  });

  test("throws when the SIEM endpoint returns a non-success status", async () => {
    mockPublicDns();
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
