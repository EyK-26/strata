import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuditExportSql } from "@getstrata/core/audit/exportAuditLogs";
import {
  createAuditExporter,
  exportPendingAuditLogs,
  resolveAuditExportConfig,
} from "@getstrata/core/audit/exportAuditLogs";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/testing";
import { SQL } from "bun";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

const originalFetch = globalThis.fetch;

function mockPublicDns(): void {
  setDnsLookupForTests(async () => [{ address: "1.1.1.1", family: 4 }]);
}

let owner: Awaited<ReturnType<typeof createNativePersistenceApplication>> | undefined;
let runSql: AuditExportSql;
let activeScopes = 0;
let backendPid = 0;
const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
async function createPendingAudit(
  action: string,
  subjectId = 99,
  title = "Export boundary",
): Promise<number> {
  return runSql(async (selected) => {
    const [created] = await selected.execute<{ id: number }>({
      text: "INSERT INTO audit_log(user_id,action,subject_type,subject_id,payload,tenant_id,created_at) VALUES(1,$1,'task',$2,$3::jsonb,1,NOW()) RETURNING id",
      params: [action, subjectId, { title }],
    });
    expect(created).toBeDefined();
    if (!created) throw Error("The audit fixture row must exist.");
    return created.id;
  });
}
async function exportedAt(id: number) {
  return runSql(async (selected) => {
    const [row] = await selected.execute<{ exported_at: Date | null }>({
      text: "SELECT exported_at FROM audit_log WHERE id=$1",
      params: [id],
    });
    expect(row).toBeDefined();
    return row?.exported_at;
  });
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  resetDnsLookupForTests();
  delete process.env.SIEM_EXPORT_URL;
  delete process.env.SIEM_EXPORT_FORMAT;
  delete process.env.SIEM_EXPORT_BATCH_SIZE;
  delete process.env.SIEM_EXPORT_TOKEN;
  await owner?.close();
  owner = undefined;
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
  beforeEach(async () => {
    if (!databaseUrl) throw Error("A real PostgreSQL runtime fixture is required.");
    owner = await createNativePersistenceApplication({
      default: "main",
      connections: { main: { driver: "pgsql", url: databaseUrl, max: 1 } },
    });
    const invoke = createPersistenceInvocation(owner.application, "main");
    activeScopes = 0;
    runSql = (work) =>
      invoke(
        { kind: "command", actor: { kind: "system", policy: "audit.export" } },
        ({ database, policy }) =>
          policy.run(database, { kind: "bypass" }, async (selected) => {
            activeScopes++;
            try {
              const [backend] = await selected.execute<{ pid: number }>({
                params: [],
                text: "SELECT pg_backend_pid() AS pid",
              });
              if (!backend) throw Error("Native PostgreSQL backend receipt is required.");
              backendPid = backend.pid;
              return await work(selected);
            } finally {
              activeScopes--;
            }
          }),
      );
    await runSql((selected) =>
      selected.execute({
        params: [],
        text: `CREATE TEMP TABLE audit_log (
      id SERIAL PRIMARY KEY,user_id BIGINT,action TEXT,subject_type TEXT,subject_id BIGINT,
      payload JSONB,tenant_id BIGINT,created_at TIMESTAMPTZ,exported_at TIMESTAMPTZ,
      trace_id TEXT,ip_address TEXT,user_agent TEXT,checksum TEXT)`,
      }),
    );
  });

  test("releases its own RLS transaction before the outbound HTTP boundary", async () => {
    const previousTenancy = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "rls";
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
        const transaction = activeScopes > 0;
        const connection = activeScopes > 0;
        expect(backendPid).toBeGreaterThan(0);
        const [activity] = await observer.unsafe<Array<{ state: string }>>(
          "SELECT state FROM pg_stat_activity WHERE pid = $1",
          [backendPid],
        );
        expect(activity?.state).toBeDefined();
        observed = {
          transaction,
          connection,
          idleInTransaction: activity?.state.startsWith("idle in transaction") ?? false,
        };
        return new Response("accepted", { status: 200 });
      }) as unknown as typeof fetch;

      expect(await exportPendingAuditLogs(runSql)).toBe(1);
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

    expect(await exportPendingAuditLogs(runSql)).toBe(1);
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

    await expect(exportPendingAuditLogs(runSql)).rejects.toThrow(
      "SIEM export failed with status 503.",
    );
    expect(await exportedAt(selected)).toBeNull();
  });

  test("does not commit or release a caller-owned transaction", async () => {
    mockPublicDns();
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-caller-transaction";
    const selected = await createPendingAudit("caller.owned");
    let accepted = 0;
    globalThis.fetch = mock(async () => {
      expect(activeScopes > 0).toBe(true);
      expect(activeScopes > 0).toBe(true);
      accepted++;
      return new Response("accepted", { status: 200 });
    }) as unknown as typeof fetch;
    const rollback = new Error("caller rollback after external acceptance");

    await expect(
      runSql(async (selected) => {
        expect(await exportPendingAuditLogs((work) => work(selected))).toBe(1);
        expect(activeScopes > 0).toBe(true);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(accepted).toBe(1);
    expect(await exportedAt(selected)).toBeNull();
  });

  test("returns zero when export is disabled", async () => {
    await expect(exportPendingAuditLogs(runSql)).resolves.toBe(0);
  });

  test("returns zero when there are no pending audit logs", async () => {
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-empty";

    await expect(exportPendingAuditLogs(runSql)).resolves.toBe(0);
  });

  test("exports pending audit logs as json without an auth token", async () => {
    mockPublicDns();
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-json-no-token";

    await createPendingAudit("task.created", 13, "No token export");

    let authorization = "unset";

    globalThis.fetch = mock((_url, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(new Response("accepted", { status: 200 }));
    }) as unknown as typeof fetch;

    const exported = await exportPendingAuditLogs(runSql);

    expect(exported).toBe(1);
    expect(authorization).toBe("");
  });

  test("exports pending audit logs as json and marks them exported", async () => {
    mockPublicDns();
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-json";
    process.env.SIEM_EXPORT_TOKEN = "export-token";

    const inserted = await createPendingAudit("task.created", 10, "Export me");

    let requestBody = "";
    let authorization = "";

    globalThis.fetch = mock((_url, init) => {
      requestBody = String(init?.body ?? "");
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(new Response("accepted", { status: 200 }));
    }) as unknown as typeof fetch;

    const exporter = createAuditExporter({ runSql, environment: process.env });
    process.env.SIEM_EXPORT_TOKEN = "different-application-token";
    const exported = await exporter();

    expect(exported).toBe(1);
    expect(authorization).toBe("Bearer export-token");
    expect(JSON.parse(requestBody).events).toHaveLength(1);

    expect(await exportedAt(inserted)).not.toBeNull();
  });

  test("exports pending audit logs as cef", async () => {
    mockPublicDns();
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-cef-export";
    process.env.SIEM_EXPORT_FORMAT = "cef";

    await createPendingAudit("task.updated", 11, "CEF export");

    let contentType = "";

    globalThis.fetch = mock((_url, init) => {
      contentType = new Headers(init?.headers).get("content-type") ?? "";
      return Promise.resolve(new Response("accepted", { status: 200 }));
    }) as unknown as typeof fetch;

    const exported = await exportPendingAuditLogs(runSql);

    expect(exported).toBe(1);
    expect(contentType).toBe("text/plain");
  });

  test("throws when the SIEM endpoint returns a non-success status", async () => {
    mockPublicDns();
    process.env.SIEM_EXPORT_URL = "http://hooks.example.com/siem-failure";

    await createPendingAudit("task.deleted", 12, "Failure export");

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("fail", { status: 503 })),
    ) as unknown as typeof fetch;

    await expect(exportPendingAuditLogs(runSql)).rejects.toThrow(
      "SIEM export failed with status 503.",
    );
  });
});
