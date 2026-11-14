/** Installed RLS exporter SQL-scope proof. HTTP is intercepted at the outbound boundary. */
import assert from "node:assert/strict";
import { type AuditExportSql, exportPendingAuditLogs } from "@getstrata/core/audit/exportAuditLogs";
import type { Application } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/testing";

const application: {
  bootstrapApp(options: {
    migrate: false;
    mode: "command";
  }): Promise<{ application: Application; invoke: PersistenceInvocation }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
const app = await application.bootstrapApp({ migrate: false, mode: "command" });
let activeSql = 0;
const runSql: AuditExportSql = (work) =>
  app.invoke(
    { kind: "command", actor: { kind: "system", policy: "audit.export" } },
    ({ database, policy }) =>
      policy.run(database, { kind: "bypass" }, async (selected) => {
        activeSql++;
        try {
          return await work(selected);
        } finally {
          activeSql--;
        }
      }),
  );
async function createPending(action: string) {
  return runSql(async (selected) => {
    const [row] = await selected.execute<{ id: number }>({
      text: "INSERT INTO audit_log(action,subject_type,payload,created_at) VALUES($1,'qualification',$2::jsonb,NOW()) RETURNING id",
      params: [action, { action }],
    });
    assert.ok(row);
    return row;
  });
}
async function exportedAt(id: number) {
  return runSql(async (selected) => {
    const [row] = await selected.execute<{ exported_at: Date | null }>({
      text: "SELECT exported_at FROM audit_log WHERE id=$1",
      params: [id],
    });
    assert.ok(row);
    return row.exported_at;
  });
}
const originalFetch = globalThis.fetch;
try {
  setDnsLookupForTests(async () => [{ address: "1.1.1.1", family: 4 }]);
  process.env.SIEM_EXPORT_URL = "https://siem.example.test/qualification";
  process.env.SIEM_EXPORT_TOKEN = "qualification-only-token";
  const first = await createPending("snapshot.selected");
  let arriving: { id: number } | undefined;
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      assert.equal(
        activeSql > 0,
        false,
        "Exporter must release its own SQL transaction before HTTP.",
      );
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer qualification-only-token",
      );
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      assert.equal(JSON.parse(String(init?.body)).events.length, 1);
      arriving = await createPending("snapshot.arriving");
      return new Response(null, { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
  assert.equal(await exportPendingAuditLogs(runSql), 1);
  assert.ok((await exportedAt(first.id)) instanceof Date);
  assert.ok(arriving);
  assert.equal(await exportedAt(arriving.id), null);

  globalThis.fetch = Object.assign(async () => new Response(null, { status: 503 }), {
    preconnect: originalFetch.preconnect,
  });
  await assert.rejects(exportPendingAuditLogs(runSql), /SIEM export failed with status 503/);
  assert.equal(await exportedAt(arriving.id), null);

  let accepted = 0;
  globalThis.fetch = Object.assign(
    async () => {
      assert.equal(activeSql > 0, true, "The caller still owns its outer transaction.");
      accepted++;
      return new Response(null, { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const rollback = new Error("qualification caller rollback");
  await assert.rejects(
    runSql(async (selected) => {
      assert.equal(await exportPendingAuditLogs((work) => work(selected)), 1);
      await selected.execute({ params: [], text: "SELECT 1" });
      throw rollback;
    }),
    (error) => error === rollback,
  );
  assert.equal(accepted, 1);
  assert.equal(await exportedAt(arriving.id), null);
  console.log(
    "PASS installed audit exporter SQL scope, exact snapshot acknowledgement, failure retention and caller rollback",
  );
} finally {
  globalThis.fetch = originalFetch;
  resetDnsLookupForTests();
  delete process.env.SIEM_EXPORT_URL;
  delete process.env.SIEM_EXPORT_TOKEN;
  const outcome = await app.application.stop();
  assert.equal(outcome.successful, true, "Application cleanup must complete.");
}
