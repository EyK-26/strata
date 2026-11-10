import type { OpenOutcome } from "../contracts/application";
import type {
  CheckoutOptions,
  Decision,
  DisposeAck,
  MysqlDatabaseOptions,
  RawPin,
  RawPool,
  RawTransaction,
  SqlStatement,
} from "./driverPorts";
import { createMysqlPool, executeMysql, type MysqlPoolConnection } from "./mysqlNative";
import { nativeTransaction } from "./nativeTransactions";
import { dialectFor } from "./sqlDialects";

/** mysql2 destroy() only calls stream.end(); its void return is not socket closure. */
function destroyMysqlConnection(connection: MysqlPoolConnection): Promise<DisposeAck> {
  const stream = connection.connection?.stream;
  if (!stream || typeof stream.once !== "function" || typeof stream.removeListener !== "function") {
    try {
      connection.destroy();
    } catch (error) {
      return Promise.resolve({ ok: false, error, ownership: "unknown" as const });
    }
    return Promise.resolve({
      ok: false,
      error: new Error("MySQL physical socket close acknowledgement is unavailable."),
      ownership: "unknown" as const,
    });
  }
  return new Promise((resolve) => {
    let invoking = true;
    let closed = stream.closed === true;
    const acknowledge = () => {
      try {
        stream.removeListener("close", onClose);
        resolve(Object.freeze({ ok: true }));
      } catch (error) {
        resolve(Object.freeze({ ok: false, error, ownership: "unknown" as const }));
      }
    };
    const onClose = () => {
      closed = true;
      if (!invoking) acknowledge();
    };
    try {
      if (!closed) stream.once("close", onClose);
      connection.destroy();
      invoking = false;
      if (closed || stream.closed === true) acknowledge();
    } catch (error) {
      invoking = false;
      try {
        stream.removeListener("close", onClose);
      } catch (cleanupError) {
        resolve({
          ok: false,
          error: new AggregateError(
            [error, cleanupError],
            "MySQL disposal and listener cleanup failed.",
          ),
          ownership: "unknown" as const,
        });
        return;
      }
      resolve({ ok: false, error, ownership: "unknown" as const });
    }
  });
}

function createMysqlPin(connection: MysqlPoolConnection): RawPin {
  let disposal: Promise<DisposeAck> | undefined;
  let running = false;
  const protocol = nativeTransaction({
    execute: <Row>(statement: SqlStatement) =>
      executeMysql<Row>(connection, statement.text, statement.params),
    async control(sql) {
      if (sql === "BEGIN") await connection.beginTransaction();
      else if (sql === "COMMIT") await connection.commit();
      else if (sql === "ROLLBACK") await connection.rollback();
      else await executeMysql(connection, sql, []);
      return {};
    },
  });
  const dispose = (discard: boolean): Promise<DisposeAck> => {
    disposal ??= (async (): Promise<DisposeAck> => {
      if (running || (!discard && protocol.state !== "idle"))
        return Object.freeze({
          ok: false,
          error: new Error("MySQL native pin is not safely idle."),
          ownership: "retained",
        });
      try {
        if (discard) return await destroyMysqlConnection(connection);
        connection.release();
        return Object.freeze({ ok: true });
      } catch (error) {
        return Object.freeze({ ok: false, error, ownership: "unknown" as const });
      }
    })();
    return disposal;
  };
  return Object.freeze({
    async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>) {
      if (disposal || running) throw new Error("MySQL pin is no longer available.");
      running = true;
      try {
        return await protocol.begin(work);
      } finally {
        running = false;
      }
    },
    release: () => dispose(false),
    discard: () => dispose(true),
  });
}
async function createRawMysqlPool(options: MysqlDatabaseOptions): Promise<RawPool> {
  const pool = await createMysqlPool(options.url, options.max);
  let closed = false;
  let retainedCleanup: { error: unknown } | undefined;
  const acquire = async () => {
    if (closed) throw new Error("MySQL pool is closed.");
    if (retainedCleanup) throw new Error("MySQL pool has unresolved physical cleanup ownership.");
    if (!pool.getConnection)
      throw new Error("MySQL transactions require a pool with getConnection().");
    return pool.getConnection();
  };
  const initialize = async (connection: MysqlPoolConnection) => {
    await executeMysql(connection, "SET time_zone = '+00:00'", []);
    const rows = await executeMysql<{ strata_session_timezone: string }>(
      connection,
      "SELECT @@session.time_zone AS strata_session_timezone",
      [],
    );
    if (rows[0]?.strata_session_timezone !== "+00:00")
      throw new Error("MySQL session UTC initialization was not confirmed.");
  };
  return Object.freeze({
    dialect: dialectFor("mysql"),
    capabilities: Object.freeze({
      driver: "mysql",
      transactions: true,
      savepoints: true,
      rowLocks: true,
      postgresRls: false,
      cancellableCheckout: false,
      observableCheckout: false,
      isolatedDiscard: true,
    }),
    async execute<Row>(statement: SqlStatement): Promise<readonly Row[]> {
      const connection = await acquire();
      let initialized = false;
      let queryFailure: { error: unknown } | undefined;
      let rows: readonly Row[] = [];
      try {
        await initialize(connection);
        initialized = true;
        rows = await executeMysql<Row>(connection, statement.text, statement.params);
      } catch (error) {
        queryFailure = { error };
      }
      let acknowledgement: DisposeAck;
      if (!initialized) acknowledgement = await destroyMysqlConnection(connection);
      else {
        try {
          connection.release();
          acknowledgement = { ok: true };
        } catch (error) {
          acknowledgement = { ok: false, error, ownership: "unknown" };
        }
      }
      if (!acknowledgement.ok) {
        retainedCleanup ??= { error: acknowledgement.error };
        throw new AggregateError(
          [...(queryFailure ? [queryFailure.error] : []), acknowledgement.error],
          "MySQL query cleanup acknowledgement failed.",
        );
      }
      if (queryFailure) throw queryFailure.error;
      return rows;
    },
    async checkout(checkout: CheckoutOptions = {}): Promise<OpenOutcome<RawPin>> {
      if (checkout.signal !== undefined || checkout.metrics !== undefined)
        return {
          ok: false,
          error: new Error("MySQL checkout does not support acquisition signal or metrics."),
          disposition: "not-acquired",
        };
      let connection: MysqlPoolConnection;
      try {
        connection = await acquire();
      } catch (error) {
        return { ok: false, error, disposition: "not-acquired" };
      }
      try {
        await initialize(connection);
        return { ok: true, value: createMysqlPin(connection) };
      } catch (error) {
        const acknowledgement = await destroyMysqlConnection(connection);
        if (acknowledgement.ok) return { ok: false, error, disposition: "cleaned" };
        retainedCleanup ??= { error: acknowledgement.error };
        return { ok: false, error, disposition: "unknown", cleanupErrors: [acknowledgement.error] };
      }
    },
    async close() {
      if (retainedCleanup) throw retainedCleanup.error;
      await pool.end();
      closed = true;
    },
  });
}

export { createMysqlPin, createRawMysqlPool, destroyMysqlConnection };
