import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import * as Core from "@getstrata/core";
import { createTransactionAcquisitionMetrics } from "@getstrata/core/database/acquisitionMetrics";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { PersistenceError } from "@getstrata/core/database/errors";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { errorResponse } from "@getstrata/core/http/response";
import { createApplication } from "@getstrata/core/runtime/application";

assert.equal(Core.DATABASE_SESSION_TOKEN, DATABASE_SESSION_TOKEN);
assert.equal(Core.PersistenceError, PersistenceError);
assert.equal(Core.createTransactionAcquisitionMetrics, createTransactionAcquisitionMetrics);
assert.equal("CORE_EXECUTION_OWNERSHIP_TOKEN" in Core, false);
assert.equal("DATABASE_MANAGER_TOKEN" in Core, false);
const paths: string[] = [];
for (const entry of [
  "@getstrata/core",
  "@getstrata/core/database/bindings",
  "@getstrata/core/database/errors",
  "@getstrata/core/database/acquisitionMetrics",
  "@getstrata/core/http/response",
  "@getstrata/core/database/session",
  "@getstrata/core/database/tokens",
  "@getstrata/core/runtime/application",
]) {
  const path = await realpath(new URL(import.meta.resolve(entry)));
  assert.ok(path.startsWith(`${process.cwd()}/node_modules/@getstrata/core/`), path);
  paths.push(path);
}
// These compile in the external application, without repository tsconfig aliases.
function publicTypes(db: DatabaseSession, tx: TransactionSession) {
  const result: Promise<readonly { value: number }[]> = db.execute<{ value: number }>({
    text: "SELECT 1 AS value",
    params: [],
  });
  // biome-ignore lint/suspicious/noConfusingVoidType: assert the public synchronous registration return type.
  const registration: void = tx.afterCommit(() => {});
  // @ts-expect-error Transaction sessions cannot switch pool.
  tx.connection("secondary");
  // @ts-expect-error Rollback intent takes no arbitrary value/reason.
  tx.requestRollback("reason");
  // @ts-expect-error No raw pool lifetime methods are exposed.
  db.close();
  // @ts-expect-error Transaction isolation is outside the frozen first-slice contract.
  db.transaction(() => 1, { isolation: "serializable" });
  // @ts-expect-error Statement parameter snapshots are readonly.
  db.execute({ text: "SELECT 1", params: [] }).then((rows) => rows.push({}));
  createDatabaseBindings({
    default: "x",
    // @ts-expect-error Unsupported driver-specific configuration.
    connections: { x: { driver: "sqlite", filename: ":memory:", max: 1 } },
  });
  return { result, registration };
}
void publicTypes;
const declarations = createDatabaseBindings({
  default: "primary",
  connections: {
    primary: { driver: "sqlite", filename: ":memory:" },
    secondary: { driver: "sqlite", filename: ":memory:" },
  },
});
assert.ok(Object.isFrozen(declarations));
const app = createApplication({ providers: [], services: declarations });
let stale: DatabaseSession | undefined;
let staleTx: TransactionSession | undefined;
const events: string[] = [];
try {
  await app.start();
  await app.run(async (scope) => {
    const db = scope.resolve(DATABASE_SESSION_TOKEN);
    stale = db;
    const other = db.connection("secondary");
    const execute = (executor: Pick<DatabaseSession, "execute">, text: string) =>
      executor.execute<{ value: number }>({ text, params: [] });
    await execute(db, "CREATE TABLE records(value INTEGER PRIMARY KEY)");
    await execute(other, "CREATE TABLE records(value INTEGER PRIMARY KEY)");
    await execute(other, "INSERT INTO records VALUES(90)");
    assert.equal(
      await db.transaction(async (tx) => {
        staleTx = tx;
        await execute(tx, "INSERT INTO records VALUES(1)");
        await tx.transaction(async (child) => {
          await execute(child, "INSERT INTO records VALUES(2)");
        });
        tx.afterCommit(async () => {
          await db.transaction(async (fresh) => {
            await execute(fresh, "INSERT INTO records VALUES(3)");
          });
          events.push("released-reentry");
        });
        return 17;
      }),
      17,
    );
    assert.equal(
      await db.transaction(async (tx) => {
        await execute(tx, "INSERT INTO records VALUES(4)");
        tx.requestRollback();
        return undefined;
      }),
      undefined,
    );
    assert.deepEqual(await execute(db, "SELECT value FROM records ORDER BY value"), [
      { value: 1 },
      { value: 2 },
      { value: 3 },
    ]);
    assert.deepEqual(await execute(other, "SELECT value FROM records"), [{ value: 90 }]);
    let nativeConstraint: unknown;
    try {
      await execute(db, "INSERT INTO records VALUES(1)");
      assert.fail("installed SQLite duplicate insert must reject");
    } catch (error) {
      nativeConstraint = error;
    }
    assert.ok(nativeConstraint instanceof PersistenceError);
    assert.ok(nativeConstraint instanceof Core.PersistenceError);
    assert.equal(nativeConstraint.code, "DATABASE_UNIQUE_CONSTRAINT");
    assert.equal("status" in nativeConstraint, false, "persistence remains transport neutral");
    assert.equal(Object.prototype.propertyIsEnumerable.call(nativeConstraint, "cause"), false);
    assert.ok(nativeConstraint.cause, "actual driver rejection is retained as opaque cause");
    const response = errorResponse(nativeConstraint);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "A record with these values already exists.",
    });
    // Cross-entrypoint construction also checks the adapter's canonical instanceof path;
    // neither transaction observations nor arbitrary causes may become HTTP details.
    const opaqueMarker = "packed-opaque-persistence-payload";
    const enriched = new Core.PersistenceError("DATABASE_UNIQUE_CONSTRAINT", {
      cause: { marker: opaqueMarker, native: nativeConstraint.cause },
      data: "rolled-back",
      result: { ok: true, value: { marker: opaqueMarker } },
    });
    const enrichedResponse = errorResponse(enriched);
    assert.equal(enrichedResponse.status, 409);
    const serialized = await enrichedResponse.text();
    assert.deepEqual(JSON.parse(serialized), {
      error: "A record with these values already exists.",
    });
    assert.equal(serialized.includes(opaqueMarker), false);

    assert.ok(Object.isFrozen(db.dialect));
    assert.ok(Object.isFrozen(db.capabilities));
    const closedTx = staleTx;
    assert.ok(closedTx);
    await assert.rejects(
      Promise.resolve().then(() => closedTx.execute({ text: "SELECT 1", params: [] })),
    );
  });
  const closedSession = stale;
  assert.ok(closedSession);
  await assert.rejects(
    Promise.resolve().then(() => closedSession.execute({ text: "SELECT 1", params: [] })),
  );
  assert.equal((await app.stop()).successful, true);
} finally {
  await app.stop();
}
assert.deepEqual(events, ["released-reentry"]);
const pgRuntimeUrl =
  process.env.M3A_PG_RUNTIME_URL ??
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.APP_DATABASE_URL;
let postgresMetrics: { status: "passed"; acquired: number } | { status: "omitted-no-runtime-url" } =
  { status: "omitted-no-runtime-url" };
if (pgRuntimeUrl) {
  const pg = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "pgsql", url: pgRuntimeUrl, max: 1 } },
    }),
  });
  const metrics = Core.createTransactionAcquisitionMetrics();
  try {
    await pg.start();
    await pg.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      assert.equal(db.capabilities.observableCheckout, true);
      assert.equal(db.capabilities.cancellableCheckout, true);
      const rows = await db.transaction(
        (tx) => tx.execute<{ value: number }>({ text: "SELECT 1 AS value", params: [] }),
        { acquisitionMetrics: metrics, acquisitionSignal: new AbortController().signal },
      );
      assert.deepEqual([...rows], [{ value: 1 }]);
    });
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.inflight, 0);
    const acquired = snapshot.outcomes.find((outcome) => outcome.outcome === "acquired")?.count;
    assert.equal(
      acquired,
      1,
      "core-root metric instance must record checkout inside installed bindings adapter",
    );
    assert.equal(snapshot.outcomes.find((outcome) => outcome.outcome === "failed")?.count, 0);
    assert.equal(snapshot.outcomes.find((outcome) => outcome.outcome === "aborted")?.count, 0);
    postgresMetrics = { status: "passed", acquired };
  } finally {
    await pg.stop();
  }
}

console.log(
  JSON.stringify({
    canonicalToken: true,
    canonicalPersistenceError: true,
    neutralConstraintHttpMapping: true,
    internalTokensHidden: true,
    namedIsolation: true,
    transaction: true,
    staleAuthorityRejected: true,
    postgresMetrics,
    paths,
  }),
);
