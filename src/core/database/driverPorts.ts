import type { OpenOutcome } from "../contracts/application";
import type { TransactionAcquisitionMetrics } from "./acquisitionMetrics";
import type { SqlDialect } from "./sqlDialects";

type SqlStatement = Readonly<{ text: string; params: readonly unknown[] }>;
type DatabaseDriver = "sqlite" | "pgsql" | "mysql";
type DatabaseCapabilities = Readonly<{
  driver: DatabaseDriver;
  transactions: true;
  savepoints: boolean;
  rowLocks: boolean;
  postgresRls: boolean;
  cancellableCheckout: boolean;
  observableCheckout: boolean;
  isolatedDiscard: boolean;
}>;
type SqliteDatabaseOptions = Readonly<{ driver: "sqlite"; filename: string }>;
type PostgresDatabaseOptions = Readonly<{
  driver: "pgsql";
  url: string;
  max?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  connectionTimeout?: number;
}>;
type MysqlDatabaseOptions = Readonly<{ driver: "mysql"; url: string; max?: number }>;
type DatabaseConnectionOptions =
  | SqliteDatabaseOptions
  | PostgresDatabaseOptions
  | MysqlDatabaseOptions;
type DatabaseDefinition = Readonly<{
  default: string;
  connections: Readonly<Record<string, DatabaseConnectionOptions>>;
  repositories?: readonly import("./definitions").AnyRepositoryDefinition[];
  models?: readonly import("./definitions").AnyModelDefinition[];
  repositoryEffects?: readonly import("./definitions").RepositoryEffectsDeclaration[];
  preparation?: readonly import("../contracts/token").AnyServiceToken[];
}>;
type TransactionOptions = Readonly<{
  acquisitionSignal?: AbortSignal;
  acquisitionMetrics?: TransactionAcquisitionMetrics;
}>;
type CheckoutOptions = Readonly<{
  signal?: AbortSignal;
  metrics?: TransactionAcquisitionMetrics;
}>;
type FailureTag = Readonly<{ error: unknown }>;
type Decision<R> = Readonly<{ finish: "commit" | "rollback"; result: R }>;
type DecisionStage<R> =
  | Readonly<{ kind: "callback-not-entered" }>
  | Readonly<{ kind: "callback-running" }>
  | Readonly<{ kind: "callback-failed"; error: unknown }>
  | Readonly<{ kind: "decided"; decision: Decision<R> }>;
type ControlPhase =
  | "begin"
  | "savepoint"
  | "release-savepoint"
  | "rollback-to"
  | "commit"
  | "rollback";
type ControlEvidence = Readonly<{
  phase: ControlPhase;
  acknowledgement: "confirmed-reply" | "proven-not-applied" | "unknown";
  failure: FailureTag | null;
}>;
type DataDisposition = "not-started" | "committed" | "rolled-back" | "unknown";
type NativeState = "idle" | "transaction-active" | "unknown";
type Terminal<R> = Readonly<{
  data: DataDisposition;
  nativeState: NativeState;
  stage: DecisionStage<R>;
  phases: readonly ControlEvidence[];
  failure: FailureTag | null;
}>;
type SavepointTerminal<R> = Readonly<{
  data: "not-started" | "released" | "rolled-back" | "unknown";
  nativeState: NativeState;
  stage: DecisionStage<R>;
  phases: readonly ControlEvidence[];
  failure: FailureTag | null;
}>;
type DisposeAck =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: unknown; ownership: "retained" | "unknown" }>;

interface RawTransaction {
  execute<Row>(statement: SqlStatement): Promise<readonly Row[]>;
  savepoint<R>(
    work: (child: RawTransaction) => Promise<Decision<R>>,
  ): Promise<SavepointTerminal<R>>;
}
interface RawPin {
  begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>>;
  release(): Promise<DisposeAck>;
  discard(): Promise<DisposeAck>;
}
interface RawPool {
  readonly dialect: SqlDialect;
  readonly capabilities: DatabaseCapabilities;
  execute<Row>(statement: SqlStatement): Promise<readonly Row[]>;
  checkout(options?: CheckoutOptions): Promise<OpenOutcome<RawPin>>;
  close(): void | Promise<void>;
}

export type {
  CheckoutOptions,
  ControlEvidence,
  ControlPhase,
  DatabaseCapabilities,
  DatabaseConnectionOptions,
  DatabaseDefinition,
  DatabaseDriver,
  DataDisposition,
  Decision,
  DecisionStage,
  DisposeAck,
  FailureTag,
  MysqlDatabaseOptions,
  NativeState,
  PostgresDatabaseOptions,
  RawPin,
  RawPool,
  RawTransaction,
  SavepointTerminal,
  SqliteDatabaseOptions,
  SqlStatement,
  Terminal,
  TransactionOptions,
};
