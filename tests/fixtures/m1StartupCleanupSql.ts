/** Owned real PostgreSQL transactions across actual failed-startup cleanup expiry. */
import assert from "node:assert/strict";
import { collectProviders } from "@getstrata/bootstrap/context";
import * as m1 from "@getstrata/bootstrap/m1";
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function contains(error: unknown, expected: unknown): boolean {
  return (
    error === expected ||
    (error instanceof AggregateError && error.errors.some((item) => contains(item, expected)))
  );
}

export async function startupCleanupSql(mode: string) {
  assert.ok(["late-commit", "native-close-rejection"].includes(mode));
  const runtimeUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  assert.ok(
    runtimeUrl && migrationUrl,
    "Owned restricted-runtime and migration fixtures required.",
  );
  process.env.APP_ENV = "test";
  process.env.TENANCY_DRIVER = "rls";
  const admin = new SQL(migrationUrl);
  const pool = new SQL({ url: runtimeUrl, max: 2 });
  registerDefaultDatabasePool(pool);
  const [role] = await pool.unsafe<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
    "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  assert.ok(role && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role.role));
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  const tableName = `m1_cleanup_${crypto.randomUUID().replaceAll("-", "")}`;
  await Schema.run(admin, "pgsql", (schema) => {
    schema.create(tableName, (table) => {
      table.integer("id").primary();
      table.integer("tenant_id");
      table.string("value");
    });
  });
  const entered = deferred(),
    gate = deferred(),
    drainEntered = deferred();
  let business: Promise<unknown> | undefined;
  let starting: Promise<unknown> | undefined;
  let closeError: unknown;
  let ownedDependencies: unknown;
  let completion: ReturnType<typeof m1.getM1StartupCleanupCompletion>;
  const order: string[] = [];
  let receipt: Record<string, unknown> | undefined;
  try {
    // Test-only policy/ACL setup on a UUID-owned table, never an app mechanism workaround.
    await admin.unsafe(
      "ALTER TABLE " +
        tableName +
        " ENABLE ROW LEVEL SECURITY;" +
        "ALTER TABLE " +
        tableName +
        " FORCE ROW LEVEL SECURITY;" +
        "CREATE POLICY owned_tenant ON " +
        tableName +
        " USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer);" +
        "GRANT SELECT,INSERT ON " +
        tableName +
        ' TO "' +
        role.role +
        '"',
    );
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
    const primary = new Error("owned-route-failure-with-active-transaction");
    routeRegistry.register({ method: "GET", path: "/before-cleanup-sql", middleware: [] });
    const before = routeRegistry.list();
    starting = m1.startGuardedApplication({
      startupCleanupTimeoutMs: 20,
      providers: [
        ...base,
        {
          name: "owned.postgres",
          register({ onCleanup, dependencies }) {
            ownedDependencies = dependencies;
            onCleanup(async () => {
              drainEntered.resolve();
              await business;
              order.push("drain-finished");
            }, "drain");
            onCleanup(async () => {
              await pool.unsafe("SELECT 1");
              order.push("flush");
            }, "flush");
            onCleanup(async () => {
              if (mode === "native-close-rejection") {
                try {
                  await pool.close({ timeout: Number.NaN });
                } catch (error) {
                  closeError = error;
                  throw error;
                }
                assert.fail("Native invalid-timeout close must reject.");
              }
              await pool.close();
              order.push("close");
            });
          },
          async boot() {
            business = runWithTenantDatabase({ id: 1, slug: "owned-one" }, async () => {
              await Item.create({ id: 1, tenant_id: 1, value: "committed-after-timeout" });
              await assert.rejects(
                runInTransaction(async () => {
                  await Item.create({ id: 3, tenant_id: 1, value: "savepoint-rolled-back" });
                  await Item.create({ id: 4, tenant_id: 2, value: "forbidden-cross-tenant" });
                }),
              );
              assert.equal(await Item.find(3), null);
              await afterCommit(async () => {
                assert.equal(currentTenantId(), 1);
                await runWithTenantDatabase({ id: 1, slug: "owned-one" }, async () => {
                  assert.equal((await Item.findOrFail(1)).get("value"), "committed-after-timeout");
                  await Item.create({ id: 2, tenant_id: 1, value: "observer-after-commit" });
                });
                order.push("observer-after-commit");
              });
              entered.resolve();
              await gate.promise;
              assert.equal(currentTenantId(), 1);
              order.push("transaction-work-finished");
            });
            await Promise.race([
              entered.promise,
              business.then(() => assert.fail("Work settled before admission.")),
            ]);
          },
        },
      ],
      modules: [
        {
          name: "reject",
          routes() {
            throw primary;
          },
        },
      ],
    });
    const observed = starting.then(
      () => ({ kind: "resolved" as const }),
      (failure) => ({ kind: "rejected" as const, failure }),
    );
    await drainEntered.promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: Awaited<typeof observed> | "pending";
    try {
      result = await Promise.race([
        observed,
        new Promise<"pending">((resolve) => {
          timer = setTimeout(() => resolve("pending"), 500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.notEqual(
      result,
      "pending",
      "Real SQL drain must not leave the caller waiting past its cleanup budget.",
    );
    assert.ok(result !== "pending" && result.kind === "rejected");
    const failure = result.failure;
    assert.ok(failure instanceof AggregateError);
    assert.equal(failure.cause, primary);
    assert.equal(m1.describeM1Failure(failure).code, "startup-cleanup-timed-out");
    completion = m1.getM1StartupCleanupCompletion(failure);
    assert.ok(completion);
    let settled = false;
    void completion.then(() => {
      settled = true;
    });
    await Bun.sleep(1);
    assert.equal(settled, false);
    assert.deepEqual(order, []);
    assert.equal(resolveApplicationDependencies(), ownedDependencies);
    await pool.unsafe("SELECT 1");
    await runWithTenantDatabase({ id: 2, slug: "owned-two" }, async () => {
      assert.deepEqual(await Item.all(), []);
    });
    await assert.rejects(
      m1.startGuardedApplication({ providers: base, modules: [] }),
      /already active/,
    );
    gate.resolve();
    const outcome = await completion;
    assert.equal(failure.cause, primary);
    assert.equal(m1.describeM1Failure(failure).code, "startup-cleanup-timed-out");
    if (mode === "native-close-rejection") {
      assert.equal(outcome.state, "cleanup-failed");
      assert.equal(outcome.startupReservationReleased, false);
      assert.ok(closeError instanceof Error);
      assert.ok(outcome.errors.some((error) => contains(error, closeError)));
      assert.deepEqual(order, [
        "transaction-work-finished",
        "observer-after-commit",
        "drain-finished",
        "flush",
      ]);
      await pool.unsafe("SELECT 1");
      await runWithTenantDatabase({ id: 2, slug: "owned-two" }, async () => {
        assert.deepEqual(await Item.all(), []);
      });
      await assert.rejects(
        m1.startGuardedApplication({ providers: base, modules: [] }),
        /already active/,
      );
    } else {
      assert.equal(outcome.state, "cleaned");
      assert.equal(outcome.startupReservationReleased, true);
      assert.deepEqual(outcome.errors, []);
      assert.deepEqual(order, [
        "transaction-work-finished",
        "observer-after-commit",
        "drain-finished",
        "flush",
        "close",
      ]);
      assert.equal(
        await pool.unsafe("SELECT 1").then(
          () => "live",
          () => "closed",
        ),
        "closed",
      );
      assert.deepEqual(routeRegistry.list(), before);
      const retry = await m1.startGuardedApplication({ providers: base, modules: [] });
      assert.equal((await retry.shutdown()).successful, true);
    }
    assert.equal(currentTenant(), null);
    assert.deepEqual(
      Array.from(await admin.unsafe(`SELECT id,tenant_id,value FROM ${tableName} ORDER BY id`)),
      [
        { id: 1, tenant_id: 1, value: "committed-after-timeout" },
        { id: 2, tenant_id: 1, value: "observer-after-commit" },
      ],
    );
    receipt = {
      mode,
      accepted: true,
      timedOut: true,
      restrictedRole: true,
      rls: true,
      savepointRollback: true,
      observerBeforeClose: true,
      order,
      state: outcome.state,
      closeFault:
        mode === "native-close-rejection" ? "invalid-native-timeout-not-network-failure" : null,
    };
  } finally {
    gate.resolve();
    await business?.catch(() => {});
    await starting?.catch(() => {});
    await completion;
    await pool.close();
    await Schema.run(admin, "pgsql", (schema) => {
      schema.drop(tableName);
    });
    const [row] = await admin.unsafe<{ relation: string | null }[]>(
      "SELECT to_regclass($1) AS relation",
      [tableName],
    );
    assert.equal(row?.relation, null);
    await admin.close();
  }
  return { ...receipt, ownedTableRemoved: true };
}
if (import.meta.main)
  console.log(JSON.stringify(await startupCleanupSql(process.argv[2] ?? "late-commit")));
