import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import type { OpenOutcome } from "../contracts/application";
import type {
  CheckoutOptions,
  Decision,
  DisposeAck,
  RawPin,
  RawPool,
  RawTransaction,
  SqliteDatabaseOptions,
  SqlStatement,
} from "./driverPorts";
import { nativeTransaction } from "./nativeTransactions";
import { dialectFor } from "./sqlDialects";

function sqliteFilename(filename: string): string {
  if (!filename.trim())
    throw new Error("SQLite path is not configured. Pass a filename or :memory:.");
  return filename === ":memory:" ? filename : resolve(filename);
}
function isRowReturning(sql: string): boolean {
  const upper = sql.replace(/\s+/g, " ").trim().toUpperCase();
  return (
    upper.includes(" RETURNING ") ||
    upper.startsWith("SELECT") ||
    upper.startsWith("WITH") ||
    upper.startsWith("PRAGMA") ||
    upper.startsWith("EXPLAIN")
  );
}
function openRawSqlitePool(options: SqliteDatabaseOptions): OpenOutcome<RawPool> {
  let filename: string;
  try {
    filename = sqliteFilename(options.filename);
  } catch (error) {
    return { ok: false, error, disposition: "not-acquired" };
  }
  let db: Database;
  try {
    db = new Database(filename, { create: true });
  } catch (error) {
    return { ok: false, error, disposition: "unknown" };
  }
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    if (filename !== ":memory:") {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
    }
  } catch (error) {
    try {
      db.close();
      return { ok: false, error, disposition: "cleaned" };
    } catch (cleanupError) {
      return { ok: false, error, disposition: "unknown", cleanupErrors: [cleanupError] };
    }
  }
  let tail = Promise.resolve();
  let pending = 0;
  let closed = false;
  let quarantined = false;
  function check() {
    if (closed) throw new Error("SQLite connection is closed.");
    if (quarantined)
      throw new Error("SQLite connection is quarantined after uncertain native state.");
  }
  function execute<Row>(statement: SqlStatement): Promise<readonly Row[]> {
    try {
      check();
      const query = db.query(statement.text);
      const params = statement.params.map((value) =>
        value instanceof Date ? value.toISOString() : value,
      ) as never[];
      if (isRowReturning(statement.text)) return Promise.resolve(query.all(...params) as Row[]);
      query.run(...params);
      return Promise.resolve([]);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  function enqueue<T>(work: () => T | Promise<T>): Promise<T> {
    try {
      check();
    } catch (error) {
      return Promise.reject(error);
    }
    pending++;
    const result = tail
      .then(() => {
        check();
        return work();
      })
      .finally(() => {
        pending--;
      });
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  const pool: RawPool = Object.freeze({
    dialect: dialectFor("sqlite"),
    capabilities: Object.freeze({
      driver: "sqlite",
      transactions: true,
      savepoints: true,
      rowLocks: false,
      postgresRls: false,
      cancellableCheckout: false,
      observableCheckout: false,
      isolatedDiscard: false,
    }),
    execute<Row>(statement: SqlStatement) {
      return enqueue(() => execute<Row>(statement));
    },
    checkout(options: CheckoutOptions = {}): Promise<OpenOutcome<RawPin>> {
      if (options.signal !== undefined || options.metrics !== undefined)
        return Promise.resolve({
          ok: false,
          error: new Error(
            "SQLite logical checkout does not support acquisition signal or metrics.",
          ),
          disposition: "not-acquired",
        });
      return new Promise((publish) => {
        const reservation: Promise<void> = enqueue(async () => {
          let unlock!: () => void;
          const slot = new Promise<void>((done) => {
            unlock = done;
          });
          let disposal: DisposeAck | undefined;
          const protocol = nativeTransaction({
            execute,
            beginSql: "BEGIN IMMEDIATE",
            state: () => (db.inTransaction ? "transaction-active" : "idle"),
            control: async (sql) => {
              check();
              db.exec(sql);
              return {};
            },
          });
          const pin: RawPin = Object.freeze({
            begin: <R>(work: (tx: RawTransaction) => Promise<Decision<R>>) => {
              if (disposal) return Promise.reject(new Error("SQLite pin is no longer active."));
              return protocol.begin(work);
            },
            async release(): Promise<DisposeAck> {
              if (disposal) return disposal;
              if (db.inTransaction || protocol.state !== "idle") {
                quarantined = true;
                unlock();
                disposal = Object.freeze({
                  ok: false,
                  error: new Error("SQLite logical slot is not safely idle."),
                  ownership: "retained",
                });
                await reservation;
                return disposal;
              }
              disposal = Object.freeze({ ok: true });
              unlock();
              await reservation;
              return disposal;
            },
            async discard(): Promise<DisposeAck> {
              if (disposal) return disposal;
              quarantined = true;
              disposal = Object.freeze({
                ok: false,
                error: new Error(
                  "SQLite shared handle quarantined; isolated discard is unavailable.",
                ),
                ownership: "retained",
              });
              unlock();
              await reservation;
              return disposal;
            },
          });
          publish({ ok: true, value: pin });
          await slot;
        });
        void reservation.catch((error) =>
          publish({ ok: false, error, disposition: "not-acquired" }),
        );
      });
    },
    close() {
      if (pending > 0) throw new Error("Drain SQLite operations before closing the connection.");
      db.close();
      closed = true;
    },
  });
  return { ok: true, value: pool };
}
function createRawSqlitePool(options: SqliteDatabaseOptions): RawPool {
  const outcome = openRawSqlitePool(options);
  if (outcome.ok) return outcome.value;
  if (outcome.cleanupErrors?.length)
    throw new AggregateError(
      [outcome.error, ...outcome.cleanupErrors],
      "SQLite initialization and cleanup failed.",
    );
  throw outcome.error;
}

export { createRawSqlitePool, openRawSqlitePool, sqliteFilename };
