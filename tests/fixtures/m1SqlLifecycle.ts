/** Real, disposable PostgreSQL ownership characterization; each mode exits in isolation. */
import assert from "node:assert/strict";
import { CORE_TENANT_RESOLVER_TOKEN } from "@getstrata/bootstrap/config";
import { collectProviders } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "@getstrata/bootstrap/m1";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { registerDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import { defineModel } from "@getstrata/core/database/model";
import { Schema } from "@getstrata/core/database/schema";
import { defineTable } from "@getstrata/core/database/table";
import { afterCommit, runInTransaction } from "@getstrata/core/database/transaction";
import { resolveApplicationDependencies } from "@getstrata/core/runtime/applicationRegistry";
import { currentTenant, currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { SQL } from "bun";

export async function m1SqlLifecycle(mode: string) {
  assert.ok(["connected", "disconnected", "native-close-rejection"].includes(mode));
  const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
  const migration = process.env.MIGRATION_DATABASE_URL;
  assert.ok(url && migration, "Owned restricted-role and migration fixtures are required.");
  process.env.TENANCY_DRIVER = "rls";
  const admin = new SQL(migration);
  const pool = new SQL({ url, max: 2 });
  registerDefaultDatabasePool(pool);
  const [role] = await pool.unsafe<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
    "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  assert.ok(role && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role.role));
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  const tableName = `m1_owned_${crypto.randomUUID().replaceAll("-", "")}`;
  await Schema.run(admin, "pgsql", (schema) => {
    schema.create(tableName, (table) => {
      table.integer("id").primary();
      table.integer("tenant_id");
      table.string("value");
    });
  });
  // Test-only RLS policy/ACL setup, never an application migration workaround.
  await admin.unsafe(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY;
    CREATE POLICY owned_tenant ON ${tableName}
      USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer);
    GRANT SELECT,INSERT ON ${tableName} TO "${role.role}"`);
  const table = defineTable<{ id: number; tenant_id: number; value: string }, "id">({
    name: tableName,
    primaryKey: "id",
    columns: ["id", "tenant_id", "value"],
  });
  class Item extends defineModel(table) {
    static override $fillable = ["id", "tenant_id", "value"];
    static override $timestamps = false;
  }
  const base = collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
  const order: string[] = [];
  let entered!: () => void;
  let release!: () => void;
  let aborted!: () => void;
  const admitted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const serverAborted = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const abort = new AbortController();
  let closeFailure: unknown;
  let app: Awaited<ReturnType<typeof startGuardedApplication>> | undefined;
  routeRegistry.register({ method: "GET", path: "/before-sql", middleware: [] });
  try {
    app = await startGuardedApplication({
      providers: [
        ...base,
        {
          name: "owned.postgres",
          register({ onCleanup, container }) {
            container.set(CORE_TENANT_RESOLVER_TOKEN, async (id: number) => ({
              id,
              slug: `owned-${id}`,
            }));
            onCleanup(async () => {
              await pool.unsafe("SELECT 1");
              order.push("flush");
            }, "flush");
            onCleanup(async () => {
              if (mode === "native-close-rejection") {
                // A deterministic fault at the native close API, not a simulated network failure.
                // The invalid timeout must be rejected without closing the live pool.
                try {
                  await pool.close({ timeout: Number.NaN });
                } catch (error) {
                  closeFailure = error;
                  throw error;
                }
                assert.fail("Native close must reject an invalid timeout.");
              }
              await pool.close();
              order.push("close");
            });
          },
        },
      ],
      modules: [
        {
          name: "sql",
          routes: () => ({
            "/work": async (request) => {
              request.signal.addEventListener("abort", aborted, { once: true });
              await runWithTenantDatabase({ id: 1, slug: "owned-one" }, async () => {
                await Item.create({ id: 1, tenant_id: 1, value: "committed" }).catch((error) => {
                  console.error("Owned ORM fixture failure:", error, error.cause);
                  throw error;
                });
                await assert.rejects(
                  runInTransaction(async () => {
                    await Item.create({ id: 3, tenant_id: 1, value: "rolled-back" });
                    await Item.create({ id: 4, tenant_id: 2, value: "cross-tenant" });
                  }),
                );
                assert.equal(await Item.find(3), null);
                await afterCommit(async () => {
                  assert.equal(currentTenantId(), 1);
                  await runWithTenantDatabase({ id: 1, slug: "owned-one" }, async () => {
                    assert.equal((await Item.findOrFail(1)).get("value"), "committed");
                    await Item.create({ id: 2, tenant_id: 1, value: "observer" });
                  });
                  order.push("observer-after-commit");
                });
                entered();
                await gate;
                assert.equal(currentTenantId(), 1);
              });
              order.push("handler-completed-inside-tenant-transaction");
              return new Response("committed");
            },
          }),
        },
      ],
    });
    const response = fetch(new URL("/work", app.server.url), { signal: abort.signal })
      .then(async (result) => ({ status: result.status, body: await result.text() }))
      .catch((error: unknown) => error);
    await Promise.race([
      admitted,
      response.then((value) => {
        throw new Error(`Request settled before SQL admission: ${JSON.stringify(value)}`);
      }),
      Bun.sleep(5000).then(() => {
        throw new Error("SQL admission timeout");
      }),
    ]);
    if (mode === "disconnected") {
      abort.abort();
      await response;
      await serverAborted;
    }
    const stopping = app.shutdown();
    assert.equal(app.shutdown(), stopping);
    await Bun.sleep(25);
    assert.deepEqual(order, []);
    assert.equal(resolveApplicationDependencies(), app.context.dependencies);
    await runWithTenantDatabase({ id: 2, slug: "owned-two" }, async () => {
      assert.equal(currentTenantId(), 2);
      assert.deepEqual(await Item.all(), []);
    });
    release();
    const result = await stopping;
    if (mode === "native-close-rejection") {
      assert.equal(result.successful, false);
      assert.ok(closeFailure instanceof Error);
      assert.ok(result.errors.length > 0);
      await pool.unsafe("SELECT 1");
      await assert.rejects(
        startGuardedApplication({ providers: base, modules: [] }),
        /already active/,
      );
      assert.ok(routeRegistry.list().some((row) => row.path === "/work"));
    } else {
      assert.equal(result.successful, true);
      if (mode === "connected")
        assert.deepEqual(await response, { status: 200, body: "committed" });
      assert.deepEqual(order, [
        "handler-completed-inside-tenant-transaction",
        "observer-after-commit",
        "flush",
        "close",
      ]);
      assert.deepEqual(routeRegistry.list(), [
        { method: "GET", path: "/before-sql", middleware: [] },
      ]);
      const restarted = await startGuardedApplication({ providers: base, modules: [] });
      assert.equal((await restarted.shutdown()).successful, true);
    }
    assert.equal(currentTenant(), null);
    assert.deepEqual(
      Array.from(await admin.unsafe(`SELECT id,tenant_id,value FROM ${tableName} ORDER BY id`)),
      [
        { id: 1, tenant_id: 1, value: "committed" },
        { id: 2, tenant_id: 1, value: "observer" },
      ],
    );
    assert.deepEqual(
      await pool.unsafe("SELECT 1").then(
        () => "live",
        () => "closed",
      ),
      mode === "native-close-rejection" ? "live" : "closed",
    );
    return {
      mode,
      role: role.role,
      restrictedRole: true,
      rls: true,
      savepointRollback: true,
      afterCommitBeforeFlushClose: true,
      order,
      retryBlocked: mode === "native-close-rejection",
      closeFailureClass: closeFailure instanceof Error ? closeFailure.name : null,
      closeFault:
        mode === "native-close-rejection" ? "invalid-native-timeout-not-network-failure" : null,
    };
  } finally {
    release?.();
    abort.abort();
    await app?.server.stop(true);
    await pool.close();
    await Schema.run(admin, "pgsql", (schema) => {
      schema.drop(tableName);
    });
    await admin.close();
    routeRegistry.clear();
  }
}
if (import.meta.main)
  console.log(JSON.stringify(await m1SqlLifecycle(process.argv[2] ?? "connected")));
