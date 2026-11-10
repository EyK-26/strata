import type { DatabaseCapabilities, SqlStatement, TransactionOptions } from "./driverPorts";
import type { SqlDialect } from "./sqlDialects";
import type { TransactionSession } from "./transactionSession";

interface DatabaseSession {
  readonly dialect: SqlDialect;
  readonly capabilities: DatabaseCapabilities;
  execute<Row>(statement: SqlStatement): Promise<readonly Row[]>;
  transaction<T>(
    work: (tx: TransactionSession) => T | Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  connection(name: string): DatabaseSession;
}

export type {
  DatabaseCapabilities,
  DatabaseConnectionOptions,
  DatabaseDefinition,
  SqlStatement,
  TransactionOptions,
} from "./driverPorts";
export type { DatabaseSession, TransactionSession };
