import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import { createTransactionAcquisitionMetrics } from "@getstrata/core/database/acquisitionMetrics";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { SQL } from "bun";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const pgUrl =
  process.env.M3A_PG_RUNTIME_URL ??
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.APP_DATABASE_URL;
const mysqlUrl = process.env.MYSQL_URL;
const drivers: Array<"sqlite" | "pgsql" | "mysql"> = ["sqlite"];
if (pgUrl) drivers.push("pgsql");
if (mysqlUrl) drivers.push("mysql");

for (const driver of drivers) {
  test(`explicit ${driver} session: native protocol, joined work and released observer reentry`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-native-session-"));
    const table = `m3a_${crypto.randomUUID().replaceAll("-", "")}`;
    const options =
      driver === "sqlite"
        ? { driver: "sqlite" as const, filename: join(directory, "native.sqlite") }
        : driver === "pgsql"
          ? { driver: "pgsql" as const, url: pgUrl ?? "", max: 1 }
          : { driver: "mysql" as const, url: mysqlUrl ?? "", max: 1 };
    const definition = { default: "primary", connections: { primary: options } };
    const app = createApplication({ providers: [], services: createDatabaseBindings(definition) });
    const witness = createApplication({
      providers: [],
      services: createDatabaseBindings(definition),
    });
    let admin: SQL | undefined;
    let created = false;
    let started = false;
    let witnessStarted = false;
    const childRelease = gate();
    const observerRelease = gate();
    let actualRun: Promise<unknown> | undefined;
    const read = (session: DatabaseSession) =>
      session.execute<{ value: number }>({
        text: `SELECT value FROM ${table} ORDER BY value`,
        params: [],
      });
    const query = (session: Pick<DatabaseSession, "execute">, text: string) =>
      session.execute({ text, params: [] });
    const visible = () => witness.run((scope) => read(scope.resolve(DATABASE_SESSION_TOKEN)));
    try {
      // PostgreSQL uses a restricted application role: only fixture setup has DDL authority.
      if (driver === "pgsql") {
        const adminUrl = process.env.M3A_PG_ADMIN_URL ?? process.env.MIGRATION_DATABASE_URL;
        if (!adminUrl) throw new Error("M3A_PG_ADMIN_URL is required with M3A_PG_RUNTIME_URL");
        const ownerUrl = new URL(adminUrl);
        const runtimeUrl = new URL(pgUrl ?? "");
        assert.equal(
          ownerUrl.pathname,
          runtimeUrl.pathname,
          "owned URLs must name the same database",
        );
        admin = new SQL({ url: adminUrl, max: 1 });
        await admin.unsafe(`CREATE TABLE ${table} (value INTEGER PRIMARY KEY)`);
        created = true;
        const role = decodeURIComponent(runtimeUrl.username).replaceAll('"', '""');
        await admin.unsafe(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO "${role}"`);
      }
      await app.start();
      started = true;
      if (!created) {
        await app.run((scope) =>
          query(
            scope.resolve(DATABASE_SESSION_TOKEN),
            `CREATE TABLE ${table} (value INTEGER PRIMARY KEY)`,
          ),
        );
        created = true;
      }
      await witness.start();
      witnessStarted = true;
      await app.run(async (scope) => {
        const db = scope.resolve(DATABASE_SESSION_TOKEN);
        expect(Object.isFrozen(db.dialect)).toBe(true);
        expect(Object.isFrozen(db.capabilities)).toBe(true);
        expect(db.capabilities.driver).toBe(driver);
        const clockBefore = Date.now();
        const clockRows = await db.execute<{ epoch_ms: number | string | bigint }>({
          text: `SELECT ${db.dialect.epochMillisecondsExpression()} AS epoch_ms`,
          params: [],
        });
        const clockAfter = Date.now();
        const databaseMilliseconds = Number(clockRows[0]?.epoch_ms);
        assert.ok(
          Number.isFinite(databaseMilliseconds),
          "database clock must decode to epoch milliseconds",
        );
        assert.ok(
          databaseMilliseconds >= clockBefore - 10000 && databaseMilliseconds <= clockAfter + 10000,
          "database wall clock must be within ten seconds of the surrounding host clock readings",
        );
        if (driver === "pgsql") {
          const rows = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>({
            text: "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
            params: [],
          });
          expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
          expect(db.capabilities.cancellableCheckout).toBe(true);
          expect(db.capabilities.observableCheckout).toBe(true);
          const metrics = createTransactionAcquisitionMetrics();
          await db.transaction((tx) => query(tx, "SELECT 1"), {
            acquisitionMetrics: metrics,
            acquisitionSignal: new AbortController().signal,
          });
          const snapshot = metrics.snapshot();
          expect(snapshot.inflight).toBe(0);
          expect(snapshot.outcomes.find((item) => item.outcome === "acquired")?.count).toBe(1);
          const cancelled = new AbortController();
          cancelled.abort(new Error("owned pre-aborted checkout"));
          let admitted = false;
          await assert.rejects(
            db.transaction(
              () => {
                admitted = true;
              },
              { acquisitionSignal: cancelled.signal },
            ),
          );
          expect(admitted).toBe(false);
        }
        if (driver === "mysql") {
          expect(
            await db.execute({
              text: "SELECT @@session.time_zone AS session_timezone",
              params: [],
            }),
          ).toEqual([{ session_timezone: "+00:00" }]);
        }
        const identitySql =
          driver === "pgsql" ? "SELECT pg_backend_pid() AS id" : "SELECT CONNECTION_ID() AS id";
        const identity = async (executor: Pick<DatabaseSession, "execute">) =>
          driver === "sqlite"
            ? undefined
            : (await executor.execute<{ id: number }>({ text: identitySql, params: [] }))[0]?.id;
        await db.transaction(async (tx) => {
          const pin = await identity(tx);
          await query(tx, `INSERT INTO ${table} VALUES (1)`);
          await tx.transaction(async (child) => {
            expect(await identity(child)).toBe(pin);
            await query(child, `INSERT INTO ${table} VALUES (2)`);
          });
          expect(await identity(tx)).toBe(pin);
          const currentReadClause = db.dialect.rowLockClause();
          const skipLockedClause = db.dialect.rowLockClause(true);
          assert.equal(db.capabilities.rowLocks, driver !== "sqlite");
          if (driver === "sqlite") {
            assert.equal(currentReadClause, "");
            assert.equal(skipLockedClause, "");
          }
          // Both native current-read forms must see this transaction's own writes.
          const locked = await tx.execute<{ value: number }>({
            text: `SELECT value FROM ${table} WHERE value = 1${currentReadClause}`,
            params: [],
          });
          const skipLocked = await tx.execute<{ value: number }>({
            text: `SELECT value FROM ${table} WHERE value = 2${skipLockedClause}`,
            params: [],
          });
          assert.deepEqual([...locked], [{ value: 1 }]);
          assert.deepEqual([...skipLocked], [{ value: 2 }]);
        });
        expect(await read(db)).toEqual([{ value: 1 }, { value: 2 }]);
        let observerCalled = false;
        const rollbackValue = await db.transaction(async (tx) => {
          await query(tx, `INSERT INTO ${table} VALUES (3)`);
          tx.afterCommit(() => {
            observerCalled = true;
          });
          tx.requestRollback();
          return false;
        });
        expect(rollbackValue).toBe(false);
        expect(observerCalled).toBe(false);
        const bodyError = new Error("owned native body rollback");
        await assert.rejects(
          db.transaction(async (tx) => {
            await query(tx, `INSERT INTO ${table} VALUES (4)`);
            throw bodyError;
          }),
          (error) => error === bodyError,
        );
        // SQL rejection is rollback-only even where the native engine permits continuing.
        await assert.rejects(
          db.transaction(async (tx) => {
            await query(tx, `INSERT INTO ${table} VALUES (5)`);
            await query(tx, `INSERT INTO ${table} VALUES (1)`).catch(() => {});
          }),
          { code: "DATABASE_TRANSACTION_ROLLBACK_ONLY", data: "rolled-back" },
        );
        await db.transaction(async (tx) => {
          await assert.rejects(
            tx.transaction(async (child) => {
              await query(child, `INSERT INTO ${table} VALUES (6)`);
              await query(child, `INSERT INTO ${table} VALUES (1)`).catch(() => {});
            }),
            { code: "DATABASE_TRANSACTION_ROLLBACK_ONLY", data: "rolled-back" },
          );
          await query(tx, `INSERT INTO ${table} VALUES (7)`);
        });
        expect(await read(db)).toEqual([{ value: 1 }, { value: 2 }, { value: 7 }]);
        if (driver === "sqlite") {
          await query(db, "PRAGMA foreign_keys = ON");
          await query(db, `CREATE TABLE ${table}_parent (id INTEGER PRIMARY KEY)`);
          await query(
            db,
            `CREATE TABLE ${table}_deferred (parent_id INTEGER REFERENCES ${table}_parent(id) DEFERRABLE INITIALLY DEFERRED)`,
          );
          let bodyCompleted = false;
          await assert.rejects(
            db.transaction(async (tx) => {
              await query(tx, `INSERT INTO ${table}_deferred VALUES (42)`);
              bodyCompleted = true;
            }),
            { code: "DATABASE_TRANSACTION_FAILED", data: "rolled-back" },
          );
          expect(bodyCompleted).toBe(true);
          expect(await query(db, `SELECT * FROM ${table}_deferred`)).toEqual([]);
          await db.transaction(async (tx) => {
            await query(tx, `INSERT INTO ${table}_parent VALUES (42)`);
            await query(tx, `INSERT INTO ${table}_deferred VALUES (42)`);
          });
          expect(await query(db, `SELECT parent_id FROM ${table}_deferred`)).toEqual([
            { parent_id: 42 },
          ]);
        }
      });
      const childEntered = gate();
      const callbackReturned = gate();
      const observerEntered = gate();
      const events: string[] = [];
      let transactionSettled = false;
      actualRun = app.run(async (scope) => {
        const db = scope.resolve(DATABASE_SESSION_TOKEN);
        const ops = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
        const transaction = db.transaction((tx) => {
          void ops.operation(async () => {
            await query(tx, `INSERT INTO ${table} VALUES (8)`);
            childEntered.resolve();
            await childRelease.promise;
            await query(tx, `INSERT INTO ${table} VALUES (9)`);
            events.push("child.done");
          });
          tx.afterCommit(async () => {
            // max:1 makes this actual reentry depend on prior physical pin release.
            await db.transaction((fresh) => query(fresh, `INSERT INTO ${table} VALUES (10)`));
            events.push("observer.reentered");
            void ops.operation(async () => {
              observerEntered.resolve();
              await observerRelease.promise;
              await query(db, `INSERT INTO ${table} VALUES (11)`);
              events.push("observer.child.done");
            });
          });
          tx.afterCommit(() => {
            events.push("observer.second");
          });
          callbackReturned.resolve();
          return "joined-value";
        });
        const observation = transaction.then(
          (value) => {
            transactionSettled = true;
            return value;
          },
          (error) => {
            transactionSettled = true;
            throw error;
          },
        );
        // Exterior waits also unblock on unexpected initialization/protocol failure.
        void observation.catch(() => {
          childEntered.resolve();
          callbackReturned.resolve();
          observerEntered.resolve();
        });
        expect(await observation).toBe("joined-value");
      });
      void actualRun.catch(() => {
        childEntered.resolve();
        callbackReturned.resolve();
        observerEntered.resolve();
      });
      await Promise.all([childEntered.promise, callbackReturned.promise]);
      expect(transactionSettled).toBe(false);
      expect(await visible()).toEqual([{ value: 1 }, { value: 2 }, { value: 7 }]);
      childRelease.resolve();
      await observerEntered.promise;
      expect(transactionSettled).toBe(false);
      expect(await visible()).toEqual([1, 2, 7, 8, 9, 10].map((value) => ({ value })));
      observerRelease.resolve();
      await actualRun;
      expect(events).toEqual([
        "child.done",
        "observer.reentered",
        "observer.child.done",
        "observer.second",
      ]);
      expect(await visible()).toEqual([1, 2, 7, 8, 9, 10, 11].map((value) => ({ value })));
    } finally {
      childRelease.resolve();
      observerRelease.resolve();
      await Promise.allSettled([actualRun]);
      const cleanupErrors: unknown[] = [];
      const cleanup = async (work: () => unknown | Promise<unknown>) => {
        try {
          await work();
        } catch (error) {
          cleanupErrors.push(error);
        }
      };
      if (witnessStarted) await cleanup(() => witness.stop());
      if (created) {
        if (admin) {
          const owner = admin;
          await cleanup(() => owner.unsafe(`DROP TABLE IF EXISTS ${table}`));
        } else if (started)
          await cleanup(() =>
            app.run((scope) =>
              query(scope.resolve(DATABASE_SESSION_TOKEN), `DROP TABLE IF EXISTS ${table}`),
            ),
          );
      }
      await cleanup(() => app.stop());
      await cleanup(() => admin?.close());
      await cleanup(() => rm(directory, { recursive: true, force: true }));
      assert.deepEqual(cleanupErrors, [], "owned native fixture cleanup failed");
    }
  }, 30000);
}
