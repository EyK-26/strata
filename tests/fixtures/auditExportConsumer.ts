/** Installed RLS exporter SQL-scope proof. HTTP is intercepted at the outbound boundary. */
import assert from "node:assert/strict";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import { exportPendingAuditLogs } from "@getstrata/core/audit/exportAuditLogs";
import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { hasActiveTransaction } from "@getstrata/core/database/transaction";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/security/safeUrl";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";

type AuditRow = {
  id: number;
  user_id: number | null;
  action: string;
  subject_type: string;
  subject_id: number | null;
  payload: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  checksum: string | null;
  tenant_id: number | null;
  trace_id: string | null;
  created_at: Date;
  exported_at: Date | null;
};
const table = defineTable<AuditRow, "id">({
  name: "audit_log",
  primaryKey: "id",
  columns: [
    "id",
    "user_id",
    "action",
    "subject_type",
    "subject_id",
    "payload",
    "ip_address",
    "user_agent",
    "checksum",
    "tenant_id",
    "trace_id",
    "created_at",
    "exported_at",
  ],
});
class AuditEntry extends defineModel(table) {
  static override $timestamps = false;
  static override $fillable = [...table.columns];
  static override $casts = {
    payload: "json",
    created_at: "datetime",
    exported_at: "datetime",
  } as const;
}
async function createPending(action: string) {
  return await AuditEntry.create({
    user_id: null,
    action,
    subject_type: "qualification",
    subject_id: null,
    payload: { action },
    ip_address: null,
    user_agent: null,
    checksum: null,
    tenant_id: null,
    trace_id: null,
    created_at: new Date(),
    exported_at: null,
  });
}
const application: {
  createApp(options: { migrate: false }): Promise<{ context: InitializedAppContext }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
const database: { closeDatabase(): Promise<void> } = await import(
  new URL("../bootstrap/database.ts", import.meta.url).href
);
const app = await application.createApp({ migrate: false });
const originalFetch = globalThis.fetch;
try {
  setDnsLookupForTests(async () => [{ address: "1.1.1.1", family: 4 }]);
  process.env.SIEM_EXPORT_URL = "https://siem.example.test/qualification";
  process.env.SIEM_EXPORT_TOKEN = "qualification-only-token";
  const first = await createPending("snapshot.selected");
  let arriving: AuditEntry | undefined;
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      assert.equal(
        hasActiveTransaction(),
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
  assert.equal(await exportPendingAuditLogs(), 1);
  assert.ok((await AuditEntry.find(first.id))?.get("exported_at") instanceof Date);
  assert.ok(arriving);
  assert.equal((await AuditEntry.find(arriving.id))?.get("exported_at"), null);

  globalThis.fetch = Object.assign(async () => new Response(null, { status: 503 }), {
    preconnect: originalFetch.preconnect,
  });
  await assert.rejects(exportPendingAuditLogs(), /SIEM export failed with status 503/);
  assert.equal((await AuditEntry.find(arriving.id))?.get("exported_at"), null);

  let accepted = 0;
  globalThis.fetch = Object.assign(
    async () => {
      assert.equal(hasActiveTransaction(), true, "The caller still owns its outer transaction.");
      accepted++;
      return new Response(null, { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const rollback = new Error("qualification caller rollback");
  await assert.rejects(
    runWithMigrationBypass(async () => {
      assert.equal(await exportPendingAuditLogs(), 1);
      throw rollback;
    }),
    (error) => error === rollback,
  );
  assert.equal(accepted, 1);
  assert.equal((await AuditEntry.find(arriving.id))?.get("exported_at"), null);
  console.log(
    "PASS installed audit exporter SQL scope, exact snapshot acknowledgement, failure retention and caller rollback",
  );
} finally {
  globalThis.fetch = originalFetch;
  resetDnsLookupForTests();
  delete process.env.SIEM_EXPORT_URL;
  delete process.env.SIEM_EXPORT_TOKEN;
  try {
    await app.context.dispose();
  } finally {
    await database.closeDatabase();
  }
}
