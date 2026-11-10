import { observeTransactionAcquisition } from "@getstrata/core/database/acquisitionMetrics";
import type { OpenOutcome } from "../contracts/application";
import type {
  CheckoutOptions,
  Decision,
  DisposeAck,
  PostgresDatabaseOptions,
  RawPin,
  RawPool,
  RawTransaction,
  SqlStatement,
} from "./driverPorts";
import { nativeTransaction } from "./nativeTransactions";
import { createNativePostgresPool } from "./postgresNative";
import { dialectFor } from "./sqlDialects";

type PostgresNativeRows = readonly unknown[] & { readonly command?: string | null };
interface PostgresNativeExecutable {
  unsafe(text: string, params: unknown[]): PromiseLike<PostgresNativeRows>;
}
interface PostgresNativeReserved extends PostgresNativeExecutable {
  release(): void | Promise<void>;
  close(options?: { timeout?: number }): void | Promise<void>;
}
interface PostgresNativePool extends PostgresNativeExecutable {
  reserve(options?: { signal?: AbortSignal }): Promise<PostgresNativeReserved>;
  close(): void | Promise<void>;
}

function postgresPin(connection: PostgresNativeReserved): RawPin {
  let disposal: Promise<DisposeAck> | undefined;
  let running = false;
  const protocol = nativeTransaction({
    execute: async <Row>(statement: SqlStatement) =>
      (await connection.unsafe(statement.text, [...statement.params])) as readonly Row[],
    async control(sql) {
      const reply = await connection.unsafe(sql, []);
      const expected = sql.startsWith("ROLLBACK")
        ? ["ROLLBACK"]
        : sql.startsWith("RELEASE")
          ? ["RELEASE"]
          : sql.startsWith("SAVEPOINT")
            ? ["SAVEPOINT"]
            : sql === "COMMIT"
              ? ["COMMIT", "ROLLBACK"]
              : ["BEGIN"];
      if (!reply.command || !expected.includes(reply.command))
        throw new Error("PostgreSQL transaction control acknowledgement was not confirmed.");
      return { command: reply.command };
    },
  });
  function dispose(discard: boolean): Promise<DisposeAck> {
    disposal ??= (async (): Promise<DisposeAck> => {
      if (running || (!discard && protocol.state !== "idle"))
        return Object.freeze({
          ok: false,
          error: new Error("PostgreSQL native pin is not safely idle."),
          ownership: "retained",
        });
      try {
        if (discard) await connection.close({ timeout: 0 });
        else await connection.release();
        return Object.freeze({ ok: true });
      } catch (error) {
        return Object.freeze({ ok: false, error, ownership: "unknown" as const });
      }
    })();
    return disposal;
  }
  return Object.freeze({
    async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>) {
      if (disposal || running) throw new Error("PostgreSQL pin is no longer available.");
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
function createRawPostgresPoolFromNative(pool: PostgresNativePool): RawPool {
  let closed = false;
  return Object.freeze({
    dialect: dialectFor("pgsql"),
    capabilities: Object.freeze({
      driver: "pgsql",
      transactions: true,
      savepoints: true,
      rowLocks: true,
      postgresRls: true,
      cancellableCheckout: true,
      observableCheckout: true,
      isolatedDiscard: true,
    }),
    async execute<Row>(statement: SqlStatement): Promise<readonly Row[]> {
      if (closed) throw new Error("PostgreSQL pool is closed.");
      return (await pool.unsafe(statement.text, [...statement.params])) as readonly Row[];
    },
    async checkout(checkout: CheckoutOptions = {}): Promise<OpenOutcome<RawPin>> {
      if (closed)
        return {
          ok: false,
          error: new Error("PostgreSQL pool is closed."),
          disposition: "not-acquired",
        };
      try {
        const acquire = () =>
          pool.reserve(checkout.signal === undefined ? undefined : { signal: checkout.signal });
        const connection = await (checkout.metrics
          ? observeTransactionAcquisition(checkout.metrics, acquire, checkout.signal)
          : acquire());
        return { ok: true, value: postgresPin(connection) };
      } catch (error) {
        return { ok: false, error, disposition: "not-acquired" };
      }
    },
    async close() {
      await pool.close();
      closed = true;
    },
  });
}

function createRawPostgresPool(options: PostgresDatabaseOptions): RawPool {
  return createRawPostgresPoolFromNative(createNativePostgresPool(options));
}

export type { PostgresNativePool, PostgresNativeReserved, PostgresNativeRows };
export { createRawPostgresPool, createRawPostgresPoolFromNative };
